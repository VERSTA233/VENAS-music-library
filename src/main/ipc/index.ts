import { ipcMain, app, dialog } from 'electron'
import { readFileSync, existsSync, cpSync, rmSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import type { LibraryPaths } from '../library/paths'
import { settings } from '../settings'
import { getDatabase, closeDatabase } from '../db'
import { scanAppendFolder, getAppendCover } from '../library/scanner'
import { parseArtists, mergeParsedArtists } from '../library/artistParser'
import { ingestSong, type IngestRequest } from '../library/ingest'
import { reloadAudioFile, setManualCover } from '../library/reload'
import { moveSongPictureToAlbum, writeArtistPicture } from '../library/coverCache'
import {
  listSongs,
  countSongs,
  getSongDetail,
  setSongArtists,
  setSongTags,
  updateSongFields,
  type SongArtistInput
} from '../db/queries/songs'
import {
  findOrCreateArtist,
  findArtistByName,
  searchArtists,
  listArtists,
  getArtistById,
  getArtistSongs
} from '../db/queries/artists'
import {
  searchAlbums,
  createAlbum,
  updateAlbumFields,
  setSongAlbum,
  removeSongAlbum,
  setAlbumArtists,
  getAlbumArtists,
  getSongAlbum,
  listAlbums,
  getAlbumById,
  getAlbumSongs,
  type AlbumArtistInput
} from '../db/queries/albums'
import { searchTags, createTag } from '../db/queries/tags'
import { listLabels, getLabelById, getLabelAlbumGroups } from '../db/queries/labels'
import { touchLastHeard, setFirstHeardDate, setScoreAndComment } from '../db/queries/songInfo'
import type { SongUpdateData } from '../../shared/types'

/* 注册全部 IPC handler，供 preload 暴露给渲染进程调用 */
export function registerIpcHandlers(paths: LibraryPaths): void {
  /* ---- Append ---- */
  ipcMain.handle('append:scan', () => scanAppendFolder(paths))
  ipcMain.handle('append:cover', (_e, fileName: string) => getAppendCover(paths, fileName))
  ipcMain.handle('append:parseArtists', (_e, artistField: string | null, titleField: string | null) => {
    const fromArtist = parseArtists(artistField)
    /* 曲名字段只用来提取 feat. 艺术家，剩余文本不当作 Primary 艺术家（否则曲名本身会被误判为艺术家） */
    const fromTitle = parseArtists(titleField, false)
    const merged = mergeParsedArtists(fromArtist.artists, fromTitle.artists)
    return { artists: merged, cleanedTitle: fromTitle.cleanedText || null }
  })
  ipcMain.handle('append:ingest', (_e, req: IngestRequest) => ingestSong(paths, req))
  ipcMain.handle('append:pickLyricFile', async () => {
    /* 允许选任意位置的 .lrc 文件，入库成功后会删除用户选中的这个源文件（不限于 Append 目录） */
    const result = await dialog.showOpenDialog({
      title: '选择歌词文件',
      defaultPath: paths.append,
      filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    return { filePath, content: readFileSync(filePath, 'utf-8') }
  })

  /* ---- Songs (Music library) ---- */
  ipcMain.handle('songs:list', (_e, offset: number, limit: number) => {
    const db = getDatabase()
    return { items: listSongs(db, offset, limit), total: countSongs(db) }
  })
  ipcMain.handle('songs:detail', (_e, songId: number) => getSongDetail(getDatabase(), songId))
  ipcMain.handle('songs:update', (_e, songId: number, data: SongUpdateData) => {
    const db = getDatabase()
    const hadAlbum = getSongAlbum(db, songId) != null

    db.transaction(() => {
      updateSongFields(db, songId, { title: data.title, bpm: data.bpm, lyric: data.lyric })
      setFirstHeardDate(db, songId, data.firstHeardDate)
      setScoreAndComment(db, songId, data.score, data.comment)
      const artistInputs: SongArtistInput[] = data.artists.map((a) => ({
        artistId: findOrCreateArtist(db, a.name),
        role: a.role,
        order: a.order
      }))
      setSongArtists(db, songId, artistInputs)
      setSongTags(db, songId, data.tagIds)

      // 专辑名清空表示解除关联；填了则新建/复用专辑并覆盖这首歌在专辑内的位置
      if (data.album?.title.trim()) {
        const albumData = {
          title: data.album.title.trim(),
          releaseDate: data.album.releaseDate,
          albumType: data.album.albumType,
          totalDiscs: data.album.totalDiscs,
          label: data.album.label
        }
        // albumId 非空表示前端已明确选定/确认使用某张已有专辑（走去重确认框/改动确认框流程），否则新建
        let albumId: number
        if (data.album.albumId != null) {
          albumId = data.album.albumId
          updateAlbumFields(db, albumId, albumData)
        } else {
          albumId = createAlbum(db, albumData)
        }
        setSongAlbum(db, songId, albumId, data.album.discNumber, data.album.trackNumber)
        if (data.album.artists.length > 0) {
          const albumArtistInputs: AlbumArtistInput[] = data.album.artists.map((a) => ({
            artistId: findOrCreateArtist(db, a.name),
            order: a.order
          }))
          setAlbumArtists(db, albumId, albumArtistInputs)
        }
      } else {
        removeSongAlbum(db, songId)
      }
    })()

    // 原本无专辑、这次新加入某张专辑：把它的独立封面迁移为该专辑的封面（专辑已有封面则丢弃这份）
    if (!hadAlbum && data.album?.title.trim()) {
      const album = getSongAlbum(db, songId)
      if (album) moveSongPictureToAlbum(paths, songId, album.id)
    }
  })
  ipcMain.handle('songs:reload', (_e, songId: number, newFileName: string) =>
    reloadAudioFile(paths, songId, newFileName)
  )
  ipcMain.handle('songs:pickReloadFile', async () => {
    /* 重载音频文件仍限定只能选 Music/ 目录内的文件，选中其他位置的文件时报错拒绝 */
    const result = await dialog.showOpenDialog({
      title: '选择用于重载的音频文件',
      defaultPath: paths.music,
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const rel = relative(paths.music, filePath)
    if (isAbsolute(rel) || rel.startsWith('..')) {
      throw new Error('所选文件必须位于 Music/ 目录内')
    }
    return rel
  })
  ipcMain.handle('songs:setManualCover', (_e, songId: number, imageData: Uint8Array) =>
    /* 渲染进程传来的是 Uint8Array，这里统一转成 Buffer 供 sharp 处理 */
    setManualCover(paths, songId, Buffer.from(imageData))
  )
  ipcMain.handle('songs:cover', (_e, songId: number) => {
    // 歌曲属于专辑则封面是专辑封面，否则是歌曲独立封面，两套目录二选一读取
    const db = getDatabase()
    const album = getSongAlbum(db, songId)
    const coverPath = album
      ? join(paths.assetsAlbumPictures, `${album.id}.jpg`)
      : join(paths.assetsSongPictures, `${songId}.jpg`)
    return existsSync(coverPath) ? readFileSync(coverPath) : null
  })

  /* ---- Artists ---- */
  ipcMain.handle('artists:search', (_e, query: string) => searchArtists(getDatabase(), query))
  /* 精确匹配（忽略大小写）：供艺术家编辑器判断某个名字入库时是"关联已有"还是"新建"，用于绿/红指示 */
  ipcMain.handle('artists:matchExact', (_e, name: string) => findArtistByName(getDatabase(), name) !== null)
  ipcMain.handle('artists:list', () => listArtists(getDatabase()))
  ipcMain.handle('artists:detail', (_e, artistId: number) => {
    const db = getDatabase()
    const artist = getArtistById(db, artistId)
    if (!artist) return null
    return { artist, songs: getArtistSongs(db, artistId) }
  })
  ipcMain.handle('artists:picture', (_e, artistId: number) => {
    const picturePath = join(paths.assetsArtistPictures, `${artistId}.jpg`)
    return existsSync(picturePath) ? readFileSync(picturePath) : null
  })
  ipcMain.handle('artists:setManualPicture', (_e, artistId: number, imageData: Uint8Array) =>
    writeArtistPicture(paths, artistId, Buffer.from(imageData))
  )
  ipcMain.handle('artists:listLabels', () => listLabels(getDatabase()))
  ipcMain.handle('artists:labelDetail', (_e, labelId: number) => {
    const db = getDatabase()
    const label = getLabelById(db, labelId)
    if (!label) return null
    return { label, groups: getLabelAlbumGroups(db, labelId) }
  })

  /* ---- Albums ---- */
  ipcMain.handle('albums:search', (_e, query: string) => searchAlbums(getDatabase(), query))
  ipcMain.handle('albums:list', () => listAlbums(getDatabase()))
  ipcMain.handle('albums:detail', (_e, albumId: number) => {
    const db = getDatabase()
    const album = getAlbumById(db, albumId)
    if (!album) return null
    return { album, songs: getAlbumSongs(db, albumId), artists: getAlbumArtists(db, albumId) }
  })
  ipcMain.handle('albums:cover', (_e, albumId: number) => {
    const coverPath = join(paths.assetsAlbumPictures, `${albumId}.jpg`)
    return existsSync(coverPath) ? readFileSync(coverPath) : null
  })

  /* ---- Tags ---- */
  ipcMain.handle('tags:search', (_e, query: string) => searchTags(getDatabase(), query))
  ipcMain.handle('tags:create', (_e, name: string, tagType: string) => createTag(getDatabase(), name, tagType))

  /* ---- Playback ---- */
  ipcMain.handle('playback:touchLastHeard', (_e, songId: number) => touchLastHeard(getDatabase(), songId))

  /* ---- Library ---- */
  ipcMain.handle('library:getRoots', () => ({ musicRoot: paths.musicRoot, systemRoot: paths.systemRoot }))

  ipcMain.handle('library:changeMusicRoot', async () => {
    /* 只改指针，不搬运 Append/Music 下的文件：新目录里没有对应文件的话，数据库记录会指向不存在的路径，需要用户自行把文件放过去 */
    const result = await dialog.showOpenDialog({
      title: '选择新的音乐目录（Append / Music 所在位置）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return false
    settings.set('musicRoot', result.filePaths[0])
    app.relaunch()
    app.exit(0)
    return true
  })

  ipcMain.handle('library:changeSystemRoot', async () => {
    /* 系统目录改动会自动把旧 .system 整个搬到新位置，保证数据库/缓存/日志不丢；目标目录下已存在同名 .system 则拒绝，避免覆盖 */
    const result = await dialog.showOpenDialog({
      title: '选择新的系统数据目录（.system 所在位置）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return false

    const newSystemRoot = result.filePaths[0]
    const newSystemDir = join(newSystemRoot, '.system')
    if (existsSync(newSystemDir)) {
      throw new Error('目标目录下已存在 .system 文件夹，请另选一个目录')
    }

    closeDatabase()
    cpSync(paths.system, newSystemDir, { recursive: true })
    rmSync(paths.system, { recursive: true, force: true })

    settings.set('systemRoot', newSystemRoot)
    app.relaunch()
    app.exit(0)
    return true
  })
}
