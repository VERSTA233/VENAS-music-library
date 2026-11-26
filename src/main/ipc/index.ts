import { ipcMain, app, dialog, shell } from 'electron'
import { rm, realpath } from 'node:fs/promises'
import { LibraryMaintenance } from '../library/maintenance'
import { inspectPlaybackFile, inspectPlaybackFormat } from '../library/playbackInfo'
import type { AudioOutputRuntime } from '../audioOutput'
import { execFile } from 'node:child_process'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { basename, join, relative, isAbsolute } from 'node:path'
import { parseAudioMetadata as parseFile } from '../library/audioMetadata'
import type { LibraryPaths } from '../library/paths'
import { settings } from '../settings'
import { getDatabase, closeDatabase, openDatabase } from '../db'
import { scanAppendFolder, getAppendCover } from '../library/scanner'
import { parseArtists, mergeParsedArtists } from '../library/artistParser'
import { ingestSong } from '../library/ingest'
import type { IngestRequest } from '../../shared/types'
import { reloadAudioFile, reloadEmbeddedCover, setManualCover } from '../library/reload'
import { moveSongPictureToAlbum, updateSongCover, writeAlbumPicture, writeArtistPicture } from '../library/coverCache'
import {
  findAlbumsWithoutSongs,
  findArtistsWithoutSongs,
  findDuplicateArtistNames,
  findMissingAudioFiles,
  repairMissingSongCovers,
  findOrphanPictureFiles
} from '../library/health'
import { deleteLibrarySong } from '../library/deleteSong'
import { cleanEmptyLibraryRecords } from '../library/healthCleanup'
import { createArtistSelectionResolver } from '../library/artistSelection'
import { copyAndVerifySystemDirectory } from '../library/systemMigration'
import { recordMigratedAppendSource } from '../library/migratedAppendSources'
import { importNeteaseMusic } from '../library/neteaseImport'
import { PlaylistExporter } from '../library/playlistExport'
import { AudioTagWriter } from '../library/audioTagWriteback'
import { AudioIntegrityScanner, clearAudioIntegrityScanState } from '../library/audioIntegrity'
import { audioFileOperations } from '../library/audioFileOperations'
import { affectedCovers } from '../library/coverUpdates'
import { deleteLibraryArtist, mergeLibraryArtist } from '../library/artistMaintenance'
import { broadcastToWindows } from '../windowBroadcast'
import {
  addAlbumOrphanCandidates,
  addSongOrphanCandidates,
  cleanupOrphanCandidates,
  createOrphanCandidates,
  removeOrphanPictures,
  type OrphanCleanupResult
} from '../library/orphanCleanup'
import {
  listSongs,
  getSongDetail,
  setSongArtists,
  setSongTags,
  updateSongFields,
  listSongFileNames,
  type SongArtistInput
} from '../db/queries/songs'
import {
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
  previewArtistAlias,
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
  updateTag,
  deleteTag
} from '../db/queries/tags'
import { listLabels, getLabelById, getLabelAlbumGroups } from '../db/queries/labels'
import { touchLastHeard, getLastHeardDates, updateSongInfo } from '../db/queries/songInfo'
import type { SongUpdateData, ArtistAliasType, ArtistUpdateData, AlbumUpdateData, PlaybackSession, NavigationSession, SongListSort, SortDirection, MusicRootInspection, TagUpdateData, AudioOutputSettings, ListSortPreferences } from '../../shared/types'
import { isListSortPreference, normalizeListSortPreferences } from '../../shared/listSorting'

/* 注册全部 IPC handler，供 preload 暴露给渲染进程调用 */
export function registerIpcHandlers(paths: LibraryPaths, audioOutputRuntime: AudioOutputRuntime): void {
  const notifyCoverUpdate = (target: Parameters<typeof affectedCovers>[1]): void => {
    const update = affectedCovers(getDatabase(), target)
    broadcastToWindows('library:coverUpdated', update)
  }
  const playlistExporter = new PlaylistExporter(paths)
  const maintenance = new LibraryMaintenance((state) => broadcastToWindows('library:maintenance', state))
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => maintenance.run(() =>
      channel === 'songs:update' || channel === 'songs:delete'
        ? audioFileOperations.run(() => listener(event, ...args))
        : listener(event, ...args)))
  }
  const tagWriter = new AudioTagWriter(paths, getDatabase, join(__dirname, 'audioTagWorker.js'),
    join(app.isPackaged ? process.resourcesPath : app.getAppPath() + '/resources', 'audio-tags', process.platform === 'win32' ? 'venas-tag-writer.exe' : 'venas-tag-writer'),
    progress => broadcastToWindows('library:audioTagProgress', progress),
    operation => maintenance.run(operation))
  ipcMain.handle('library:getAudioTagProgress', () => tagWriter.progress)
  handle('library:startAudioTagWrite', () => tagWriter.start())
  ipcMain.handle('library:cancelAudioTagWrite', () => tagWriter.cancel())
  const integrityScanner = new AudioIntegrityScanner(paths, getDatabase,
    join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'audio-inspect', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    progress => broadcastToWindows('library:audioIntegrityProgress', progress),
    operation => maintenance.run(operation))
  // 编码检查结果不跨应用进程保留；问题文件也不会在同一进程的后续扫描中被缓存跳过。
  clearAudioIntegrityScanState(getDatabase())
  handle('library:getAudioIntegrityProgress', () => integrityScanner.progress)
  handle('library:startAudioIntegrityScan', () => integrityScanner.start())
  ipcMain.handle('library:cancelAudioIntegrityScan', () => integrityScanner.cancel())
  app.on('before-quit', event => {
    if (!tagWriter.running && !integrityScanner.running) return
    event.preventDefault()
    tagWriter.cancel()
    integrityScanner.cancel()
    void Promise.allSettled([tagWriter.completion, integrityScanner.completion]).then(() => app.quit())
  })
  ipcMain.handle('library:getMaintenanceState', () => maintenance.state)
  let choosingSystemRoot = false

  /* ---- Append ---- */
  handle('append:scan', () => scanAppendFolder(paths))
  handle('append:cover', (_e, fileName: string) => getAppendCover(paths, fileName))
  handle('append:parseArtists', (_e, artistField: string | null, titleField: string | null) => {
    const fromArtist = parseArtists(artistField)
    /* 曲名字段只用来提取 feat. 艺术家，剩余文本不当作 Primary 艺术家（否则曲名本身会被误判为艺术家） */
    const fromTitle = parseArtists(titleField, false)
    const merged = mergeParsedArtists(fromArtist.artists, fromTitle.artists)
    return { artists: merged, cleanedTitle: fromTitle.cleanedText || null }
  })
  handle('append:ingest', async (_e, req: IngestRequest) => {
    const result = await ingestSong(paths, req)
    recordMigratedAppendSource(req.fileName, req.targetFileName)
    return result
  })
  handle('append:delete', (_e, fileName: string) => {
    const filePath = join(paths.append, fileName)
    const relativePath = relative(paths.append, filePath)
    if (basename(fileName) !== fileName || isAbsolute(relativePath) || relativePath.startsWith('..')) {
      throw new Error('Append 文件名不合法，拒绝删除')
    }
    /* 文件已被移动或手动删除时视为目标已达成，让编辑窗正常关闭。 */
    if (existsSync(filePath)) unlinkSync(filePath)
  })
  handle('append:importNeteaseMusic', () => importNeteaseMusic(paths, settings.get('neteaseMusicRoot')))
  handle('append:pickLyricFile', async () => {
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
  handle('songs:list', (_e, sort: SongListSort = 'library', query = '', direction: SortDirection = 'desc') => {
    const db = getDatabase()
    const items = listSongs(db, sort, query, direction)
    return { items, total: items.length }
  })
  handle('songs:detail', (_e, songId: number) => getSongDetail(getDatabase(), songId))
  handle('songs:delete', (_e, songId: number) => deleteLibrarySong(paths, getDatabase(), songId))
  handle('songs:update', async (_e, songId: number, data: SongUpdateData) => {
    const db = getDatabase()
    const previousAlbumId = getSongAlbum(db, songId)?.id ?? null
    const orphanCandidates = createOrphanCandidates()
    addSongOrphanCandidates(db, orphanCandidates, songId)
    if (data.album?.albumId != null) addAlbumOrphanCandidates(db, orphanCandidates, data.album.albumId)
    let cleanupResult: OrphanCleanupResult = { albumIds: [], artistIds: [] }

    const updateMetadata = (): void => {
      const resolveArtist = createArtistSelectionResolver(db)
      updateSongFields(db, songId, { title: data.title, lyric: data.lyric })
      updateSongInfo(db, songId, data)
      const artistInputs: SongArtistInput[] = data.artists.filter((a) => a.name.trim()).map((a, order) => ({
        artistId: resolveArtist(a),
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
          artistId: resolveArtist(a),
          order
        }))
        setAlbumArtists(db, albumId, albumArtistInputs)
      } else {
        removeSongAlbum(db, songId)
      }
      cleanupResult = cleanupOrphanCandidates(db, orphanCandidates)
    }

    /* 文件重命名/替换与其余歌曲信息共用一个数据库事务，文件操作失败时恢复原路径。 */
    const audioResult = await reloadAudioFile(paths, songId, data.replacementFilePath, data.fileName, updateMetadata)
    removeOrphanPictures(paths, cleanupResult)

    // 原本无专辑、这次新加入某张专辑：把它的独立封面迁移为该专辑的封面（专辑已有封面则丢弃这份）
    if (previousAlbumId === null && data.album?.title.trim()) {
      const album = getSongAlbum(db, songId)
      if (album) moveSongPictureToAlbum(paths, songId, album.id)
    }
    const nextAlbumId = getSongAlbum(db, songId)?.id ?? null
    if (audioResult.audioReplaced || previousAlbumId !== nextAlbumId) notifyCoverUpdate({ songId })

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
  handle('songs:pickReloadFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择用于重载的音频文件',
      defaultPath: paths.append,
      filters: [{ name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'ape'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    return { filePath, fileName: basename(filePath) }
  })
  handle('songs:setManualCover', async (_e, songId: number, imageData: Uint8Array) => {
    /* 渲染进程传来的是 Uint8Array，这里统一转成 Buffer 供 sharp 处理 */
    await setManualCover(paths, songId, Buffer.from(imageData))
    notifyCoverUpdate({ songId })
  })
  handle('songs:reloadEmbeddedCover', async (_e, songId: number) => {
    await reloadEmbeddedCover(paths, songId)
    notifyCoverUpdate({ songId })
  })
  handle('songs:cover', (_e, songId: number) => {
    // 歌曲属于专辑则封面是专辑封面，否则是歌曲独立封面，两套目录二选一读取
    const db = getDatabase()
    const album = getSongAlbum(db, songId)
    const coverPath = album
      ? join(paths.assetsAlbumPictures, `${album.id}.jpg`)
      : join(paths.assetsSongPictures, `${songId}.jpg`)
    return existsSync(coverPath) ? readFileSync(coverPath) : null
  })
  /* 播放时优先读取音频内嵌封面；首次发现封面时同步建立缓存，供列表及后续播放复用。 */
  handle('songs:embeddedCover', async (_e, songId: number) => {
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
          notifyCoverUpdate({ songId })
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
  handle('artists:search', (_e, query: string) => searchArtists(getDatabase(), query))
  handle('artists:searchLabels', (_e, query: string) => searchLabels(getDatabase(), query))
  handle('artists:findExact', (_e, name: string) => findArtistByName(getDatabase(), name))
  handle('artists:matchLabelExact', (_e, name: string) => findLabelByName(getDatabase(), name) !== null)
  handle('artists:list', () => listArtists(getDatabase()))
  handle('artists:detail', (_e, artistId: number) => {
    const db = getDatabase()
    const artist = getArtistById(db, artistId)
    if (!artist) return null
    return { artist, members: getArtistMembers(db, artistId), aliasOf: getArtistAliasOf(db, artistId), songs: getArtistSongs(db, artistId) }
  })
  handle('artists:picture', (_e, artistId: number) => {
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
  handle('artists:setManualPicture', async (_e, artistId: number, imageData: Uint8Array) => {
    await writeArtistPicture(paths, artistId, Buffer.from(imageData))
    notifyCoverUpdate({ artistId })
  })
  handle('artists:update', (_e, artistId: number, data: ArtistUpdateData) =>
    updateArtistInfo(getDatabase(), artistId, data.name, data.type, data.country, data.memberIds ?? [])
  )
  handle('artists:delete', (_e, artistId: number) =>
    deleteLibraryArtist(paths, getDatabase(), artistId)
  )
  handle('artists:merge', (_e, sourceArtistId: number, targetArtistId: number) =>
    mergeLibraryArtist(paths, getDatabase(), sourceArtistId, targetArtistId)
  )
  handle('artists:setAlias', (_e, aliasArtistId: number, canonicalArtistId: number | null, aliasType: ArtistAliasType) => {
    const db = getDatabase()
    const previousCanonicalId = getArtistAliasOf(db, aliasArtistId)?.id
    setArtistAlias(db, aliasArtistId, canonicalArtistId, aliasType)
    /* 别名归属会改变主艺名的兜底封面候选，刷新旧、新主艺名及当前艺术家。 */
    const nextCanonicalId = getArtistAliasOf(db, aliasArtistId)?.id
    for (const artistId of new Set([aliasArtistId, previousCanonicalId, nextCanonicalId])) {
      if (artistId != null) notifyCoverUpdate({ artistId })
    }
  })
  handle('artists:previewAlias', (_e, aliasArtistId: number, canonicalArtistId: number, aliasType: ArtistAliasType) =>
    previewArtistAlias(getDatabase(), aliasArtistId, canonicalArtistId, aliasType)
  )
  handle('artists:listLabels', () => listLabels(getDatabase()))
  handle('artists:labelDetail', (_e, labelId: number) => {
    const db = getDatabase()
    const label = getLabelById(db, labelId)
    if (!label) return null
    return { label, members: getArtistMembers(db, labelId), groups: getLabelAlbumGroups(db, labelId) }
  })

  /* ---- Albums ---- */
  handle('albums:search', (_e, query: string) => searchAlbums(getDatabase(), query))
  handle('albums:list', () => listAlbums(getDatabase()))
  handle('albums:update', (_e, albumId: number, data: AlbumUpdateData) => {
    const db = getDatabase()
    const orphanCandidates = createOrphanCandidates()
    addAlbumOrphanCandidates(db, orphanCandidates, albumId)
    let cleanupResult: OrphanCleanupResult = { albumIds: [], artistIds: [] }
    db.transaction(() => {
      const resolveArtist = createArtistSelectionResolver(db)
      updateAlbumFields(db, albumId, data)
      const albumArtistInputs: AlbumArtistInput[] = data.artists
        .filter((artist) => artist.name.trim())
        .map((artist, order) => ({
          artistId: resolveArtist(artist),
          order
        }))
      setAlbumArtists(db, albumId, albumArtistInputs)
      cleanupResult = cleanupOrphanCandidates(db, orphanCandidates)
    })()
    removeOrphanPictures(paths, cleanupResult)
  })
  handle('albums:setManualCover', async (_e, albumId: number, imageData: Uint8Array) => {
    await writeAlbumPicture(paths, albumId, Buffer.from(imageData))
    notifyCoverUpdate({ albumId })
  })
  handle('albums:detail', (_e, albumId: number) => {
    const db = getDatabase()
    const album = getAlbumById(db, albumId)
    if (!album) return null
    return { album, songs: getAlbumSongs(db, albumId), artists: getAlbumArtists(db, albumId) }
  })
  handle('albums:cover', (_e, albumId: number) => {
    const coverPath = join(paths.assetsAlbumPictures, `${albumId}.jpg`)
    return existsSync(coverPath) ? readFileSync(coverPath) : null
  })

  /* ---- Tags ---- */
  handle('tags:search', (_e, query: string) => searchTags(getDatabase(), query))
  handle('tags:create', (_e, name: string, tagType: string) => createTag(getDatabase(), name, tagType))
  handle('tags:listTypes', () => listTagTypes(getDatabase()))
  handle('tags:listByType', (_e, tagType: string) => listTagsByType(getDatabase(), tagType))
  handle('tags:detail', (_e, tagId: number) => {
    const db = getDatabase()
    const tag = getTagById(db, tagId)
    if (!tag) return null
    return { tag, songs: getTagSongs(db, tagId) }
  })
  handle('tags:removeSong', (_e, tagId: number, songId: number) =>
    removeSongFromTag(getDatabase(), tagId, songId)
  )
  handle('tags:setSongComment', (_e, tagId: number, songId: number, comment: string | null) =>
    setSongTagComment(getDatabase(), tagId, songId, comment)
  )
  handle('tags:setSongOrder', (_e, tagId: number, songIds: number[]) =>
    setTagSongOrder(getDatabase(), tagId, songIds)
  )
  handle('tags:update', (_e, tagId: number, data: TagUpdateData) =>
    updateTag(getDatabase(), tagId, data.name, data.tagType)
  )
  handle('tags:delete', (_e, tagId: number) => deleteTag(getDatabase(), tagId))

  /* ---- Playback ---- */
  const audioOutputSettings = (): AudioOutputSettings => ({
    supported: process.platform === 'darwin',
    selectedBackend: settings.get('macAudioBackend') === 'auhal' ? 'auhal' : 'avfoundation',
    ...audioOutputRuntime
  })
  handle('playback:getAudioOutput', () => audioOutputSettings())
  handle('playback:setAudioOutput', (_e, backend: unknown) => {
    if (process.platform !== 'darwin') throw new Error('此音频输出选项仅适用于 macOS')
    if (backend !== 'auhal' && backend !== 'avfoundation') throw new Error('音频输出后端无效')
    settings.set('macAudioBackend', backend)
    // Chromium 启动参数只能在启动前设置；保存偏好不会改变本次进程的运行后端。
    return audioOutputSettings()
  })
  handle('playback:getVolume', () => settings.get('playbackVolume'))
  handle('playback:setVolume', (_e, value: { volume: number; muted: boolean }) => {
    if (!value || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 || typeof value.muted !== 'boolean') throw new Error('音量设置无效')
    settings.set('playbackVolume', { volume: value.volume, muted: value.muted })
  })
  handle('playback:inspectFile', (_e, mediaUrl: string) => inspectPlaybackFile(paths, mediaUrl))
  handle('playback:formatInfo', (_e, mediaUrl: string) => inspectPlaybackFormat(paths, mediaUrl))
  handle('playback:getGapless', () => settings.get('gaplessEnabled'))
  handle('playback:setGapless', (_e, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('无缝播放设置无效')
    settings.set('gaplessEnabled', enabled)
  })
  handle('playback:touchLastHeard', (_e, songId: number) => touchLastHeard(getDatabase(), songId))
  handle('playback:lastHeardDates', () => getLastHeardDates(getDatabase()))
  handle('playback:getSession', () => settings.get('playbackSession'))
  handle('playback:saveSession', (_e, session: PlaybackSession | null) => settings.set('playbackSession', session))

  /* ---- Navigation ---- */
  handle('navigation:getSession', () => settings.get('navigationSession'))
  handle('navigation:saveSession', (_e, session: NavigationSession) => settings.set('navigationSession', session))
  handle('navigation:getListSortPreferences', () => normalizeListSortPreferences(settings.get('listSortPreferences')))
  handle('navigation:setListSortPreference', (_e, key: keyof ListSortPreferences, preference: ListSortPreferences[keyof ListSortPreferences]) => {
    if (!isListSortPreference(key, preference)) throw new Error('排序设置无效')
    const preferences = normalizeListSortPreferences(settings.get('listSortPreferences'))
    settings.set('listSortPreferences', { ...preferences, [key]: preference })
  })

  /* ---- Library ---- */
  handle('library:getRoots', () => ({
    musicRoot: paths.musicRoot,
    systemRoot: paths.systemRoot,
    neteaseMusicRoot: settings.get('neteaseMusicRoot')
  }))
  handle('library:checkMissingAudio', () => findMissingAudioFiles(paths, getDatabase()))
  handle('library:inspectPlaylistExport', () => playlistExporter.inspect(getDatabase()))
  handle('library:generatePlaylists', (_e, token: string, skipMissing: boolean) => playlistExporter.generate(token, skipMissing === true))
  handle('library:cancelPlaylistExport', (_e, token: string) => playlistExporter.cancel(token))
  handle('library:openPlaylistFolder', async () => {
    const error = await shell.openPath(join(paths.music, 'Playlist'))
    if (error) throw new Error(error)
  })
  handle('library:checkMissingCovers', () => repairMissingSongCovers(paths, getDatabase()))
  handle('library:checkOrphanPictures', () => findOrphanPictureFiles(paths, getDatabase()))
  handle('library:checkAlbumsWithoutSongs', () => findAlbumsWithoutSongs(getDatabase()))
  handle('library:checkArtistsWithoutSongs', () => findArtistsWithoutSongs(getDatabase()))
  handle('library:checkDuplicateArtistNames', () => findDuplicateArtistNames(getDatabase()))
  handle('library:cleanAlbumsWithoutSongs', (_e, ids: number[]) => cleanEmptyLibraryRecords(paths, getDatabase(), 'album', ids))
  handle('library:cleanArtistsWithoutSongs', (_e, ids: number[]) => cleanEmptyLibraryRecords(paths, getDatabase(), 'artist', ids))

  handle('library:openDatabaseTerminal', () => {
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

  handle('library:pickMusicRoot', async (): Promise<MusicRootInspection | null> => {
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

  handle('library:confirmMusicRootChange', (_e, musicRoot: string) => {
    if (integrityScanner.running) throw new Error('请先停止编码检查，再更换音乐目录')
    if (tagWriter.running) throw new Error('请先停止标签写入，再更换音乐目录')
    /* 目录选择后的确认步骤只修改配置并重启，绝不复制、移动或删除任何音频文件。 */
    if (!musicRoot || !existsSync(musicRoot)) throw new Error('目标音乐目录不存在')
    settings.set('musicRoot', musicRoot)
    app.relaunch()
    app.exit(0)
    return true
  })

  handle('library:changeNeteaseMusicRoot', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择网易云音乐下载目录',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const directory = result.filePaths[0]
    settings.set('neteaseMusicRoot', directory)
    return directory
  })

  /* 迁移本身不进入普通请求队列，避免等待自身；重复迁移直接拒绝。 */
  ipcMain.handle('library:changeSystemRoot', async () => {
    if (integrityScanner.running) throw new Error('请先停止编码检查，再迁移系统目录')
    if (tagWriter.running) throw new Error('请先停止标签写入，再迁移系统目录')
    if (choosingSystemRoot || maintenance.state) throw new Error('系统目录正在迁移，请等待完成')
    choosingSystemRoot = true
    try {
      const result = await dialog.showOpenDialog({
        title: '选择新的系统数据目录（.system 所在位置）',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return false

      const newSystemRoot = await realpath(result.filePaths[0])
      const currentSystem = await realpath(paths.system)
      const relativeToCurrent = relative(currentSystem, newSystemRoot)
      if (newSystemRoot === currentSystem || (!isAbsolute(relativeToCurrent) && !relativeToCurrent.startsWith('..'))) {
        throw new Error('新的系统目录不能位于当前 .system 文件夹内')
      }
      if (existsSync(join(newSystemRoot, '.system'))) throw new Error('目标目录下已存在 .system 文件夹，请另选一个目录')

      await maintenance.begin()
      let databaseClosed = false
      try {
        closeDatabase()
        databaseClosed = true
        await copyAndVerifySystemDirectory(paths, newSystemRoot, (state) => maintenance.update(state))
        settings.set('systemRoot', newSystemRoot)
      } catch (error) {
        /* 先恢复连接，再放行等待的库操作。无法恢复连接时重启到仍被配置为当前目录的旧库。 */
        try {
          if (databaseClosed) openDatabase(paths.dbFile)
        } catch {
          app.relaunch()
          app.exit(1)
          return false
        }
        maintenance.finish()
        throw error
      }

      maintenance.update({ phase: 'finishing', completed: 0, total: 0 })
      try {
        await rm(paths.system, { recursive: true, force: false })
      } catch {
        /* 新副本已经校验并提交配置；清理失败保留旧目录，仍重启到新库。 */
      }
      app.relaunch()
      app.exit(0)
      return true
    } finally {
      choosingSystemRoot = false
    }
  })
}
