import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppendEntry,
  ParsedArtist,
  IngestRequest,
  IngestResult,
  ReloadResult,
  ReloadFileSelection,
  SongListItem,
  SongListSort,
  SongDetail,
  SongUpdateData,
  ArtistRow,
  ArtistAliasOf,
  ArtistAliasType,
  ArtistListItem,
  ArtistUpdateData,
  TagRow,
  TagUpdateData,
  TagTypeItem,
  TagListItem,
  TagSongItem,
  AlbumRow,
  AlbumUpdateData,
  AlbumMatchCandidate,
  AlbumListItem,
  AlbumSongItem,
  LabelListItem,
  LabelAlbumGroup,
  PlaybackSession,
  NavigationSession,
  MusicRootInspection,
  MissingAudioFile,
  MissingSongCover,
  OrphanPictureFiles,
  NeteaseImportResult
} from '../shared/types'

/*
 * 二进制数据跨 IPC 边界一律用 Uint8Array：渲染进程是浏览器上下文，没有 Node 的 Buffer 全局对象，
 * 用 Buffer 类型会在运行时报 ReferenceError。Electron 的结构化克隆能正确传输 Uint8Array/Buffer 二进制内容，
 * 主进程那侧的 Buffer 本身就是 Uint8Array 的子类，无需额外转换。
 */
const api = {
  append: {
    scan: (): Promise<AppendEntry[]> => ipcRenderer.invoke('append:scan'),
    cover: (fileName: string): Promise<Uint8Array | null> => ipcRenderer.invoke('append:cover', fileName),
    mediaUrl: (fileName: string): string => `venas-media://append/${encodeURIComponent(fileName)}`,
    parseArtists: (
      artistField: string | null,
      titleField: string | null
    ): Promise<{ artists: ParsedArtist[]; cleanedTitle: string | null }> =>
      ipcRenderer.invoke('append:parseArtists', artistField, titleField),
    ingest: (req: IngestRequest): Promise<IngestResult> => ipcRenderer.invoke('append:ingest', req),
    importNeteaseMusic: (): Promise<NeteaseImportResult> => ipcRenderer.invoke('append:importNeteaseMusic'),
    delete: (fileName: string): Promise<void> => ipcRenderer.invoke('append:delete', fileName),
    /* 弹出系统原生文件选择对话框挑选歌词文件（不限目录），取消时返回 null */
    pickLyricFile: (): Promise<{ filePath: string; content: string } | null> =>
      ipcRenderer.invoke('append:pickLyricFile')
  },
  songs: {
    list: (sort: SongListSort = 'library', query = ''): Promise<{ items: SongListItem[]; total: number }> =>
      ipcRenderer.invoke('songs:list', sort, query),
    detail: (songId: number): Promise<SongDetail | null> => ipcRenderer.invoke('songs:detail', songId),
    delete: (songId: number): Promise<void> => ipcRenderer.invoke('songs:delete', songId),
    update: (songId: number, data: SongUpdateData): Promise<ReloadResult> =>
      ipcRenderer.invoke('songs:update', songId, data),
    setManualCover: (songId: number, imageData: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('songs:setManualCover', songId, imageData),
    cover: (songId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('songs:cover', songId),
    embeddedCover: (songId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('songs:embeddedCover', songId),
    /* 拼 venas-media:// URL 给 <audio> 直接播放，纯字符串操作不需要走 IPC */
    mediaUrl: (fileName: string): string => `venas-media://music/${encodeURIComponent(fileName)}`,
    /* 弹出系统原生文件选择对话框挑选重载用的音频文件；取消时返回 null */
    pickReloadFile: (): Promise<ReloadFileSelection | null> => ipcRenderer.invoke('songs:pickReloadFile')
  },
  artists: {
    search: (query: string): Promise<ArtistRow[]> => ipcRenderer.invoke('artists:search', query),
    searchLabels: (query: string): Promise<ArtistRow[]> => ipcRenderer.invoke('artists:searchLabels', query),
    /* 精确匹配（忽略大小写），用于艺术家编辑器判断入库时是关联已有还是新建 */
    matchExact: (name: string): Promise<boolean> => ipcRenderer.invoke('artists:matchExact', name),
    matchLabelExact: (name: string): Promise<boolean> => ipcRenderer.invoke('artists:matchLabelExact', name),
    /* Artist 星云第一层网格：全量列表（不含厂牌），附带每人关联曲目数 */
    list: (): Promise<ArtistListItem[]> => ipcRenderer.invoke('artists:list'),
    /* 第二层详情页：艺术家本身信息 + 关联的全部曲目；艺术家不存在返回 null */
    detail: (artistId: number): Promise<{ artist: ArtistRow; members: ArtistRow[]; aliasOf: ArtistAliasOf | null; songs: SongListItem[] } | null> =>
      ipcRenderer.invoke('artists:detail', artistId),
    /* Artist 星云内"厂牌"分组第一层网格：全量厂牌列表，附带旗下专辑数/曲目数 */
    listLabels: (): Promise<LabelListItem[]> => ipcRenderer.invoke('artists:listLabels'),
    /* 厂牌详情页：厂牌本身信息 + 按专辑分组的全部曲目；厂牌不存在返回 null */
    labelDetail: (labelId: number): Promise<{ label: ArtistRow; members: ArtistRow[]; groups: LabelAlbumGroup[] } | null> =>
      ipcRenderer.invoke('artists:labelDetail', labelId),
    /* 艺术家/厂牌头像：共用 artists 表与同一套接口 */
    picture: (artistId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('artists:picture', artistId),
    setManualPicture: (artistId: number, imageData: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('artists:setManualPicture', artistId, imageData),
    /* 编辑弹窗保存 Type/国家 */
    update: (artistId: number, data: ArtistUpdateData): Promise<void> =>
      ipcRenderer.invoke('artists:update', artistId, data),
    delete: (artistId: number): Promise<void> => ipcRenderer.invoke('artists:delete', artistId),
    merge: (sourceArtistId: number, targetArtistId: number): Promise<void> =>
      ipcRenderer.invoke('artists:merge', sourceArtistId, targetArtistId),
    setAlias: (aliasArtistId: number, canonicalArtistId: number, aliasType: ArtistAliasType): Promise<void> =>
      ipcRenderer.invoke('artists:setAlias', aliasArtistId, canonicalArtistId, aliasType)
  },
  albums: {
    search: (query: string): Promise<AlbumMatchCandidate[]> => ipcRenderer.invoke('albums:search', query),
    /* Album 画廊第一层网格：全量列表，附带专辑艺术家拼接字符串与曲目数 */
    list: (): Promise<AlbumListItem[]> => ipcRenderer.invoke('albums:list'),
    /* 第二层详情页：专辑本身信息 + 按碟号/曲目号排序好的曲目列表 + 专辑艺术家；专辑不存在返回 null */
    detail: (
      albumId: number
    ): Promise<{ album: AlbumRow; songs: AlbumSongItem[]; artists: { id: number; name: string; order: number }[] } | null> =>
      ipcRenderer.invoke('albums:detail', albumId),
    cover: (albumId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('albums:cover', albumId),
    update: (albumId: number, data: AlbumUpdateData): Promise<void> => ipcRenderer.invoke('albums:update', albumId, data),
    setManualCover: (albumId: number, imageData: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('albums:setManualCover', albumId, imageData)
  },
  tags: {
    search: (query: string): Promise<TagRow[]> => ipcRenderer.invoke('tags:search', query),
    create: (name: string, tagType: string): Promise<number> => ipcRenderer.invoke('tags:create', name, tagType),
    /* 第一层：全部 tag_type 分组列表 */
    listTypes: (): Promise<TagTypeItem[]> => ipcRenderer.invoke('tags:listTypes'),
    /* 第二层：某个类型下的全部 Tag */
    listByType: (tagType: string): Promise<TagListItem[]> => ipcRenderer.invoke('tags:listByType', tagType),
    /* 第三层：某个 Tag 详情 + 关联曲目（含各自 comment） */
    detail: (tagId: number): Promise<{ tag: TagRow; songs: TagSongItem[] } | null> =>
      ipcRenderer.invoke('tags:detail', tagId),
    removeSong: (tagId: number, songId: number): Promise<void> => ipcRenderer.invoke('tags:removeSong', tagId, songId),
    setSongComment: (tagId: number, songId: number, comment: string | null): Promise<void> =>
      ipcRenderer.invoke('tags:setSongComment', tagId, songId, comment),
    /* 用完整 song_id 顺序写回 song_tags.sort_order。 */
    setSongOrder: (tagId: number, songIds: number[]): Promise<void> =>
      ipcRenderer.invoke('tags:setSongOrder', tagId, songIds),
    updateType: (tagId: number, tagType: string | null): Promise<void> =>
      ipcRenderer.invoke('tags:updateType', tagId, tagType),
    update: (tagId: number, data: TagUpdateData): Promise<void> =>
      ipcRenderer.invoke('tags:update', tagId, data),
    delete: (tagId: number): Promise<void> => ipcRenderer.invoke('tags:delete', tagId)
  },
  playback: {
    touchLastHeard: (songId: number): Promise<void> => ipcRenderer.invoke('playback:touchLastHeard', songId),
    getSession: (): Promise<PlaybackSession | null> => ipcRenderer.invoke('playback:getSession'),
    saveSession: (session: PlaybackSession | null): Promise<void> => ipcRenderer.invoke('playback:saveSession', session)
  },
  navigation: {
    getSession: (): Promise<NavigationSession> => ipcRenderer.invoke('navigation:getSession'),
    saveSession: (session: NavigationSession): Promise<void> => ipcRenderer.invoke('navigation:saveSession', session)
  },
  library: {
    getRoots: (): Promise<{ musicRoot: string; systemRoot: string; neteaseMusicRoot: string | null }> =>
      ipcRenderer.invoke('library:getRoots'),
    checkMissingAudio: (): Promise<MissingAudioFile[]> => ipcRenderer.invoke('library:checkMissingAudio'),
    checkMissingCovers: (): Promise<MissingSongCover[]> => ipcRenderer.invoke('library:checkMissingCovers'),
    checkOrphanPictures: (): Promise<OrphanPictureFiles> => ipcRenderer.invoke('library:checkOrphanPictures'),
    /* 选择后只扫描目标目录，不修改设置或文件；由确认接口完成切换。 */
    pickMusicRoot: (): Promise<MusicRootInspection | null> => ipcRenderer.invoke('library:pickMusicRoot'),
    /* 不搬运文件，只保存新的音乐根目录并重启应用。 */
    confirmMusicRootChange: (musicRoot: string): Promise<boolean> => ipcRenderer.invoke('library:confirmMusicRootChange', musicRoot),
    /* 仅保存网易云音乐下载目录；导入时只读取其根层文件。 */
    changeNeteaseMusicRoot: (): Promise<string | null> => ipcRenderer.invoke('library:changeNeteaseMusicRoot'),
    /* 会自动把旧 .system 整体搬到新目录再重启，同步等待搬运完成 */
    changeSystemRoot: (): Promise<boolean> => ipcRenderer.invoke('library:changeSystemRoot'),
    openDatabaseTerminal: (): Promise<void> => ipcRenderer.invoke('library:openDatabaseTerminal')
  }
}

export type Api = typeof api

/* contextIsolation 开启时，只能通过 contextBridge 向渲染进程暴露白名单 API */
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
