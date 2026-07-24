import { unlinkSync, existsSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { parseFile } from 'music-metadata'
import type { LibraryPaths } from './paths'
import { getDatabase } from '../db'
import { getSongDetail, updateSongFields } from '../db/queries/songs'
import { updateSongCover } from './coverCache'
import type { ReloadResult } from '../../shared/types'

export type { ReloadResult }

export class ReloadError extends Error {}

/*
 * 用 Music/ 目录内的另一个文件重载指定歌曲：
 * - 仅限从 Music/ 目录内选择新文件
 * - 只重新提取 length（时长）与封面，更新 file_name；删除旧物理文件
 * - title/bpm/lyric 等由用户维护的字段保持不变，不被新文件的元数据覆盖
 * - 保留新文件本身的文件名，不强制改回标准格式
 * - song_id 不变，艺术家/Tag/song_info 关联不受影响
 */
export async function reloadAudioFile(
  paths: LibraryPaths,
  songId: number,
  newFileNameInMusic: string
): Promise<ReloadResult> {
  const db = getDatabase()
  const song = getSongDetail(db, songId)
  if (!song) throw new ReloadError('歌曲不存在')

  const newPath = join(paths.music, newFileNameInMusic)
  const resolvedRelative = relative(paths.music, newPath)
  if (isAbsolute(resolvedRelative) || resolvedRelative.startsWith('..')) {
    throw new ReloadError('新文件必须位于 Music/ 目录内')
  }
  if (!existsSync(newPath)) {
    throw new ReloadError('所选文件不存在')
  }

  const oldFileName = song.file_name
  const oldPath = join(paths.music, oldFileName)

  const meta = await parseFile(newPath)
  const length = meta.format.duration ? Math.round(meta.format.duration) : null
  const cover = meta.common.picture?.[0] ? Buffer.from(meta.common.picture[0].data) : null

  updateSongFields(db, songId, { length, file_name: newFileNameInMusic })

  if (oldFileName !== newFileNameInMusic && existsSync(oldPath)) {
    unlinkSync(oldPath)
  }

  let coverCacheFailed = false
  if (cover) {
    try {
      await updateSongCover(paths, db, songId, cover)
    } catch {
      // 封面缓存写入失败不阻塞重载流程，但需要告知前端
      coverCacheFailed = true
    }
  } else {
    // 新文件没有内嵌封面：同样标记为失败，提示用户可手动上传封面兜底
    coverCacheFailed = true
  }

  return { coverCacheFailed }
}

/* 用户手动上传一张图片作为指定歌曲的封面（manual=true：属于专辑时总是覆盖专辑封面） */
export async function setManualCover(paths: LibraryPaths, songId: number, imageData: Buffer): Promise<void> {
  const db = getDatabase()
  await updateSongCover(paths, db, songId, imageData, { manual: true })
}
