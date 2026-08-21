import { ipcMain, app, dialog } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { basename, join, relative, isAbsolute, resolve } from 'node:path'
import { parseFile } from 'music-metadata'
import type { LibraryPaths } from '../library/paths'
import { settings } from '../settings'
import { getDatabase, closeDatabase, openDatabase } from '../db'
import { scanAppendFolder, getAppendCover } from '../library/scanner'
import { parseArtists, mergeParsedArtists } from '../library/artistParser'
import { ingestSong, type IngestRequest } from '../library/ingest'
import { reloadAudioFile, setManualCover } from '../library/reload'
import { moveSongPictureToAlbum, updateSongCover, writeAlbumPicture, writeArtistPicture } from '../library/coverCache'
import { findMissingAudioFiles, findMissingSongCovers, findOrphanPictureFiles } from '../library/health'
import { deleteLibrarySong } from '../library/deleteSong'
import { copyAndVerifySystemDirectory } from '../library/systemMigration'
import { recordMigratedAppendSource } from '../library/migratedAppendSources'
import { importNeteaseMusic } from '../library/neteaseImport'
import { deleteLibraryArtist, mergeLibraryArtist } from '../library/artistMaintenance'
import {
  listSongs,
  countSongs,
  getSongDetail,
  setSongArtists,
  setSongTags,
  updateSongFields,
  listSongFileNames,
  type SongArtistInput
} from '../db/queries/songs'
import {
  findOrCreateArtist,
  findArtistByName,
  findLabelByName,
  searchArtists,
  searchLabels,
  listArtists,
  getArtistById,
  getArtistMembers,
  getArtistAliasOf,
  getArtistSongs,
  getArtistCoverCandidates,
  setArtistAlias,
  updateArtistInfo
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
import {
  searchTags,
  createTag,
  listTagTypes,
  listTagsByType,
  getTagById,
  getTagSongs,
  removeSongFromTag,
  setSongTagComment,
  setTagSongOrder,
  updateTagType,
  updateTag,
  deleteTag
} from '../db/queries/tags'
import { listLabels, getLabelById, getLabelAlbumGroups } from '../db/queries/labels'
import { touchLastHeard, setFirstHeardDate, setScoreAndComment } from '../db/queries/songInfo'
import type { SongUpdateData, ArtistAliasType, ArtistUpdateData, AlbumUpdateData, PlaybackSession, NavigationSession, SongListSort, MusicRootInspection, TagUpdateData } from '../../shared/types'

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
  ipcMain.handle('append:ingest', async (_e, req: IngestRequest) => {
    const result = await ingestSong(paths, req)
    recordMigratedAppendSource(req.fileName, req.targetFileName)
    return result
  })
  ipcMain.handle('append:delete', (_e, fileName: string) => {
    const filePath = join(paths.append, fileName)
    const relativePath = relative(paths.append, filePath)
    if (basename(fileName) !== fileName || isAbsolute(relativePath) || relativePath.startsWith('..')) {
      throw new Error('Append 文件名不合法，拒绝删除')
    }
    /* 文件已被移动或手动删除时视为目标已达成，让编辑窗正常关闭。 */
    if (existsSync(filePath)) unlinkSync(filePath)
  })
  ipcMain.handle('append:importNeteaseMusic', () => importNeteaseMusic(paths, settings.get('neteaseMusicRoot')))
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
  ipcMain.handle('songs:list', (_e, sort: SongListSort = 'library', query = '') => {
    const db = getDatabase()
    return { items: listSongs(db, sort, query), total: countSongs(db, query) }
  })
  ipcMain.handle('songs:detail', (_e, songId: number) => getSongDetail(getDatabase(), songId))
  ipcMain.handle('songs:delete', (_e, songId: number) => deleteLibrarySong(paths, getDatabase(), songId))
  ipcMain.handle('songs:update', async (_e, songId: number, data: SongUpdateData) => {
    const db = getDatabase()
    const hadAlbum = getSongAlbum(db, songId) != null

    const updateMetadata = (): void => {
      updateSongFields(db, songId, { title: data.title, lyric: data.lyric })
      setFirstHeardDate(db, songId, data.firstHeardDate)
      setScoreAndComment(db, songId, data.score, data.comment)
      const artistInputs: SongArtistInput[] = data.artists.filter((a) => a.name.trim()).map((a, order) => ({
        artistId: findOrCreateArtist(db, a.name.trim(), a.type),
        role: a.role,
        order
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
          labels: data.album.labels
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
        // 用户已确认应用专辑信息时，专辑艺术家同样按当前表单完整覆盖；空列表表示明确清空关联。
        const albumArtistInputs: AlbumArtistInput[] = data.album.artists.filter((a) => a.name.trim()).map((a, order) => ({
          artistId: findOrCreateArtist(db, a.name.trim(), a.type),
          order
        }))
        setAlbumArtists(db, albumId, albumArtistInputs)
      } else {
        removeSongAlbum(db, songId)
      }
    }

    /* 文件重命名/替换与其余歌曲信息共用一个数据库事务，文件操作失败时恢复原路径。 */
    const audioResult = await reloadAudioFile(paths, songId, data.replacementFilePath, data.fileName, updateMetadata)

    // 原本无专辑、这次新加入某张专辑：把它的独立封面迁移为该专辑的封面（专辑已有封面则丢弃这份）
    if (!hadAlbum && data.album?.title.trim()) {
      const album = getSongAlbum(db, songId)
      if (album) moveSongPictureToAlbum(paths, songId, album.id)
    }

    /* 编辑时从外部导入的歌词在数据库更新完成后不再需要；清空关联时 lyricFilePath 为 null，不删除源文件。 */
    if (data.lyricFilePath) {
      try {
        unlinkSync(data.lyricFilePath)
      } catch {
        // 源文件被用户手动删除等情况不影响歌曲更新结果
      }
    }
    return audioResult
  })
  ipcMain.handle('songs:pickReloadFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择用于重载的音频文件',
      defaultPath: paths.music,
      filters: [{ name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'ape'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    return { filePath, fileName: basename(filePath) }
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
  /* 播放时优先读取音频内嵌封面；首次发现封面时同步建立缓存，供列表及后续播放复用。 */
  ipcMain.handle('songs:embeddedCover', async (_e, songId: number) => {
    const db = getDatabase()
    const song = getSongDetail(db, songId)
    if (!song) return null
    try {
      const metadata = await parseFile(join(paths.music, song.file_name))
      const picture = metadata.common.picture?.[0]
      if (!picture) return null

      const imageData = Buffer.from(picture.data)
      const album = getSongAlbum(db, songId)
      const cachePath = album
        ? join(paths.assetsAlbumPictures, `${album.id}.jpg`)
        : join(paths.assetsSongPictures, `${songId}.jpg`)

      if (!existsSync(cachePath)) {
        try {
          await updateSongCover(paths, db, songId, imageData)
        } catch {
          // 缓存压缩或写入失败不应阻塞当前播放，仍返回刚从源文件取得的封面。
        }
      }

      return imageData
    } catch {
      return null
    }
  })

  /* ---- Artists ---- */
  ipcMain.handle('artists:search', (_e, query: string) => searchArtists(getDatabase(), query))
  ipcMain.handle('artists:searchLabels', (_e, query: string) => searchLabels(getDatabase(), query))
  /* 精确匹配（忽略大小写）：供艺术家编辑器判断某个名字入库时是"关联已有"还是"新建"，用于绿/红指示 */
  ipcMain.handle('artists:matchExact', (_e, name: string) => findArtistByName(getDatabase(), name) !== null)
  ipcMain.handle('artists:matchLabelExact', (_e, name: string) => findLabelByName(getDatabase(), name) !== null)
  ipcMain.handle('artists:list', () => listArtists(getDatabase()))
  ipcMain.handle('artists:detail', (_e, artistId: number) => {
    const db = getDatabase()
    const artist = getArtistById(db, artistId)
    if (!artist) return null
    return { artist, members: getArtistMembers(db, artistId), aliasOf: getArtistAliasOf(db, artistId), songs: getArtistSongs(db, artistId) }
  })
  ipcMain.handle('artists:picture', (_e, artistId: number) => {
    const picturePath = join(paths.assetsArtistPictures, `${artistId}.jpg`)
    if (existsSync(picturePath)) return readFileSync(picturePath)

    const db = getDatabase()
    for (const candidate of getArtistCoverCandidates(db, artistId)) {
      const coverPaths = candidate.albumId === null
        ? [join(paths.assetsSongPictures, `${candidate.songId}.jpg`)]
        : [
            join(paths.assetsAlbumPictures, `${candidate.albumId}.jpg`),
            join(paths.assetsSongPictures, `${candidate.songId}.jpg`)
          ]
      for (const coverPath of coverPaths) {
        if (existsSync(coverPath)) return readFileSync(coverPath)
      }
    }

    return null
  })
  ipcMain.handle('artists:setManualPicture', (_e, artistId: number, imageData: Uint8Array) =>
    writeArtistPicture(paths, artistId, Buffer.from(imageData))
  )
  ipcMain.handle('artists:update', (_e, artistId: number, data: ArtistUpdateData) =>
    updateArtistInfo(getDatabase(), artistId, data.name, data.type, data.country, data.memberIds ?? [])
  )
  ipcMain.handle('artists:delete', (_e, artistId: number) =>
    deleteLibraryArtist(paths, getDatabase(), artistId)
  )
  ipcMain.handle('artists:merge', (_e, sourceArtistId: number, targetArtistId: number) =>
    mergeLibraryArtist(paths, getDatabase(), sourceArtistId, targetArtistId)
  )
  ipcMain.handle('artists:setAlias', (_e, aliasArtistId: number, canonicalArtistId: number, aliasType: ArtistAliasType) =>
    setArtistAlias(getDatabase(), aliasArtistId, canonicalArtistId, aliasType)
  )
  ipcMain.handle('artists:listLabels', () => listLabels(getDatabase()))
  ipcMain.handle('artists:labelDetail', (_e, labelId: number) => {
    const db = getDatabase()
    const label = getLabelById(db, labelId)
    if (!label) return null
    return { label, members: getArtistMembers(db, labelId), groups: getLabelAlbumGroups(db, labelId) }
  })

  /* ---- Albums ---- */
  ipcMain.handle('albums:search', (_e, query: string) => searchAlbums(getDatabase(), query))
  ipcMain.handle('albums:list', () => listAlbums(getDatabase()))
  ipcMain.handle('albums:update', (_e, albumId: number, data: AlbumUpdateData) => {
    const db = getDatabase()
    db.transaction(() => {
      updateAlbumFields(db, albumId, data)
      const albumArtistInputs: AlbumArtistInput[] = data.artists
        .filter((artist) => artist.name.trim())
        .map((artist, order) => ({
          artistId: findOrCreateArtist(db, artist.name.trim(), artist.type),
          order
        }))
      setAlbumArtists(db, albumId, albumArtistInputs)
    })()
  })
  ipcMain.handle('albums:setManualCover', (_e, albumId: number, imageData: Uint8Array) =>
    writeAlbumPicture(paths, albumId, Buffer.from(imageData))
  )
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
  ipcMain.handle('tags:listTypes', () => listTagTypes(getDatabase()))
  ipcMain.handle('tags:listByType', (_e, tagType: string) => listTagsByType(getDatabase(), tagType))
  ipcMain.handle('tags:detail', (_e, tagId: number) => {
    const db = getDatabase()
    const tag = getTagById(db, tagId)
    if (!tag) return null
    return { tag, songs: getTagSongs(db, tagId) }
  })
  ipcMain.handle('tags:removeSong', (_e, tagId: number, songId: number) =>
    removeSongFromTag(getDatabase(), tagId, songId)
  )
  ipcMain.handle('tags:setSongComment', (_e, tagId: number, songId: number, comment: string | null) =>
    setSongTagComment(getDatabase(), tagId, songId, comment)
  )
  ipcMain.handle('tags:setSongOrder', (_e, tagId: number, songIds: number[]) =>
    setTagSongOrder(getDatabase(), tagId, songIds)
  )
  ipcMain.handle('tags:updateType', (_e, tagId: number, tagType: string | null) =>
    updateTagType(getDatabase(), tagId, tagType)
  )
  ipcMain.handle('tags:update', (_e, tagId: number, data: TagUpdateData) =>
    updateTag(getDatabase(), tagId, data.name, data.tagType)
  )
  ipcMain.handle('tags:delete', (_e, tagId: number) => deleteTag(getDatabase(), tagId))

  /* ---- Playback ---- */
  ipcMain.handle('playback:touchLastHeard', (_e, songId: number) => touchLastHeard(getDatabase(), songId))
  ipcMain.handle('playback:getSession', () => settings.get('playbackSession'))
  ipcMain.handle('playback:saveSession', (_e, session: PlaybackSession | null) => settings.set('playbackSession', session))

  /* ---- Navigation ---- */
  ipcMain.handle('navigation:getSession', () => settings.get('navigationSession'))
  ipcMain.handle('navigation:saveSession', (_e, session: NavigationSession) => settings.set('navigationSession', session))

  /* ---- Library ---- */
  ipcMain.handle('library:getRoots', () => ({
    musicRoot: paths.musicRoot,
    systemRoot: paths.systemRoot,
    neteaseMusicRoot: settings.get('neteaseMusicRoot')
  }))
  ipcMain.handle('library:checkMissingAudio', () => findMissingAudioFiles(paths, getDatabase()))
  ipcMain.handle('library:checkMissingCovers', () => findMissingSongCovers(paths, getDatabase()))
  ipcMain.handle('library:checkOrphanPictures', () => findOrphanPictureFiles(paths, getDatabase()))

  ipcMain.handle('library:openDatabaseTerminal', () => {
    if (process.platform !== 'darwin') throw new Error('数据库终端入口目前仅支持 macOS')
    const shellQuotedPath = `'${paths.dbFile.replace(/'/g, "'\\''")}'`
    const command = `sqlite3 ${shellQuotedPath}`
    const appleScriptCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return new Promise<void>((resolve, reject) => {
      execFile(
        'osascript',
        ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "${appleScriptCommand}"`],
        (error) => (error ? reject(error) : resolve())
      )
    })
  })

  ipcMain.handle('library:pickMusicRoot', async (): Promise<MusicRootInspection | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择新的音乐目录（Append / Music 所在位置）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const musicRoot = result.filePaths[0]
    const fileNames = listSongFileNames(getDatabase())
    const missingFiles = fileNames.filter((fileName) => !existsSync(join(musicRoot, 'Music', fileName)))
    return { musicRoot, totalSongs: fileNames.length, missingFiles }
  })

  ipcMain.handle('library:confirmMusicRootChange', (_e, musicRoot: string) => {
    /* 目录选择后的确认步骤只修改配置并重启，绝不复制、移动或删除任何音频文件。 */
    if (!musicRoot || !existsSync(musicRoot)) throw new Error('目标音乐目录不存在')
    settings.set('musicRoot', musicRoot)
    app.relaunch()
    app.exit(0)
    return true
  })

  ipcMain.handle('library:changeNeteaseMusicRoot', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择网易云音乐下载目录',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const directory = result.filePaths[0]
    settings.set('neteaseMusicRoot', directory)
    return directory
  })

  ipcMain.handle('library:changeSystemRoot', async () => {
    /* 系统目录迁移先复制到临时目录并做逐文件 SHA-256 校验；校验成功后才切换设置和删除旧目录。 */
    const result = await dialog.showOpenDialog({
      title: '选择新的系统数据目录（.system 所在位置）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return false

    const newSystemRoot = result.filePaths[0]
    const currentSystem = resolve(paths.system)
    const selectedRoot = resolve(newSystemRoot)
    const relativeToCurrent = relative(currentSystem, selectedRoot)
    /* 目标若位于当前 .system 内，迁移完成后的清理会把新副本一并删除。 */
    if (selectedRoot === currentSystem || (!isAbsolute(relativeToCurrent) && !relativeToCurrent.startsWith('..'))) {
      throw new Error('新的系统目录不能位于当前 .system 文件夹内')
    }
    closeDatabase()
    try {
      await copyAndVerifySystemDirectory(paths, newSystemRoot)
      settings.set('systemRoot', newSystemRoot)
    } catch (error) {
      /* 配置尚未切换，继续使用旧库，避免一次失败的迁移让当前进程失去数据库连接。 */
      openDatabase(paths.dbFile)
      throw error
    }

    /* 新目录已通过完整性校验且设置已成功落盘，此时才移除旧目录。删除失败时保留旧副本并直接重启到已验证的新库。 */
    try {
      rmSync(paths.system, { recursive: true, force: false })
    } catch {
      app.relaunch()
      app.exit(0)
      return true
    }
    app.relaunch()
    app.exit(0)
    return true
  })
}
