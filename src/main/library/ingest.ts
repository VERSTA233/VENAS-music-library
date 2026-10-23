import { renameSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseFile } from 'music-metadata'
import type { LibraryPaths } from './paths'
import { getDatabase } from '../db'
import { findOrCreateArtist } from '../db/queries/artists'
import { createTag } from '../db/queries/tags'
import { createAlbum, updateAlbumFields, setSongAlbum, setAlbumArtists, type AlbumArtistInput } from '../db/queries/albums'
import { createSong, setSongArtists, setSongTags, isFileNameTaken, type SongArtistInput } from '../db/queries/songs'
import { createSongInfoOnIngest } from '../db/queries/songInfo'
import { updateSongCover } from './coverCache'
import {
  addAlbumOrphanCandidates,
  cleanupOrphanCandidates,
  createOrphanCandidates,
  removeOrphanPictures,
  type OrphanCleanupResult
} from './orphanCleanup'
import type { IngestRequest, IngestResult } from '../../shared/types'

export type { IngestRequest, IngestResult }

export class IngestConflictError extends Error {}

/* 格式化为 "YYYY-MM-DD HH:MM:SS" 本地时间，与库内 DATETIME('now','localtime') 的格式保持一致 */
function formatLocalDateTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`
}

/* 执行入库：Append -> Music 移动 + 写库 + 封面缓存。任一数据库步骤失败则把文件移回 Append。 */
export async function ingestSong(paths: LibraryPaths, req: IngestRequest): Promise<IngestResult> {
  const db = getDatabase()
  if (!req.fileName || basename(req.fileName) !== req.fileName || /[/\\]/.test(req.fileName)) {
    throw new IngestConflictError('Append 源文件名不合法')
  }
  const sourcePath = join(paths.append, req.fileName)
  const targetFileName = req.targetFileName
  if (
    !targetFileName ||
    targetFileName !== targetFileName.trim() ||
    basename(targetFileName) !== targetFileName ||
    /[/\\]/.test(targetFileName)
  ) {
    throw new IngestConflictError('目标文件名不能为空、包含前后空格或路径分隔符')
  }
  const targetPath = join(paths.music, targetFileName)

  if (isFileNameTaken(db, targetFileName) || existsSync(targetPath)) {
    throw new IngestConflictError(`目标文件已存在：${targetFileName}，请修改文件名后重试`)
  }

  // 入库前先提取元数据（时长、封面），此时文件仍在 Append
  const meta = await parseFile(sourcePath, { duration: true })
  const length = meta.format.duration ? Math.round(meta.format.duration) : null
  const cover = meta.common.picture?.[0] ? Buffer.from(meta.common.picture[0].data) : null
  // add_time 记录音频文件本身的修改时间，而非入库操作发生的时刻；需在文件被移动前读取
  const addTime = formatLocalDateTime(statSync(sourcePath).mtime)

  renameSync(sourcePath, targetPath)

  let songId: number
  const orphanCandidates = createOrphanCandidates()
  if (req.album?.albumId != null) addAlbumOrphanCandidates(db, orphanCandidates, req.album.albumId)
  let cleanupResult: OrphanCleanupResult = { albumIds: [], artistIds: [] }
  try {
    songId = db.transaction(() => {
      const id = createSong(db, {
        title: req.title,
        length,
        lyric: req.lyric,
        file_name: targetFileName
      })

      const artistInputs: SongArtistInput[] = req.artists.filter((a) => a.name.trim()).map((a, order) => ({
        artistId: findOrCreateArtist(db, a.name.trim(), a.type),
        role: a.role,
        order
      }))
      setSongArtists(db, id, artistInputs)

      const tagIds = req.tags.map((t) => (t.id != null ? t.id : createTag(db, t.name!, t.tagType!)))
      setSongTags(db, id, tagIds)

      // 专辑可选：不填专辑名则不建立专辑关联，允许无专辑单曲
      if (req.album?.title.trim()) {
        const albumData = {
          title: req.album.title.trim(),
          releaseDate: req.album.releaseDate,
          albumType: req.album.albumType,
          totalDiscs: req.album.totalDiscs,
          labels: req.album.labels
        }
        // albumId 非空表示前端已明确选定/确认使用某张已有专辑（走去重确认框/改动确认框流程），否则新建
        let albumId: number
        if (req.album.albumId != null) {
          albumId = req.album.albumId
          updateAlbumFields(db, albumId, albumData)
        } else {
          albumId = createAlbum(db, albumData)
        }
        setSongAlbum(db, id, albumId, req.album.discNumber, req.album.trackNumber)

        // 入库确认即视为用户确认应用当前专辑信息；空列表表示明确清空已有专辑艺术家关联。
        const albumArtistInputs: AlbumArtistInput[] = req.album.artists.filter((a) => a.name.trim()).map((a, order) => ({
          artistId: findOrCreateArtist(db, a.name.trim(), a.type),
          order
        }))
        setAlbumArtists(db, albumId, albumArtistInputs)
      }

      createSongInfoOnIngest(db, id, addTime, req.firstHeardDate, req.score, req.comment)
      cleanupResult = cleanupOrphanCandidates(db, orphanCandidates)

      return id
    })()
  } catch (err) {
    // 回滚：把文件移回 Append，保持系统一致状态
    renameSync(targetPath, sourcePath)
    throw err
  }
  removeOrphanPictures(paths, cleanupResult)

  // 歌词已写入 songs.lyric，源歌词文件（自动匹配到的或用户通过对话框选中的，可能不在 Append 目录内）不再需要，删除失败不影响入库结果
  if (req.lyricFilePath) {
    try {
      unlinkSync(req.lyricFilePath)
    } catch {
      // 忽略：文件可能已被手动删除，不影响入库结果
    }
  }

  let coverCacheFailed = false
  if (cover) {
    try {
      await updateSongCover(paths, db, songId, cover)
    } catch {
      // 封面缓存失败不影响入库结果，但需要告知前端；Music 列表在此之前会显示占位图
      coverCacheFailed = true
    }
  }

  return { songId, coverCacheFailed }
}
