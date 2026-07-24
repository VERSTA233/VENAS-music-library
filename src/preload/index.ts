import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppendEntry,
  ParsedArtist,
  IngestRequest,
  IngestResult,
  ReloadResult,
  SongListItem,
  SongDetail,
  SongUpdateData,
  ArtistRow,
  ArtistListItem,
  TagRow,
  AlbumRow,
  AlbumMatchCandidate,
  AlbumListItem,
  AlbumSongItem,
  LabelListItem,
  LabelAlbumGroup
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
    /* 弹出系统原生文件选择对话框挑选歌词文件（不限目录），取消时返回 null */
    pickLyricFile: (): Promise<{ filePath: string; content: string } | null> =>
      ipcRenderer.invoke('append:pickLyricFile')
  },
  songs: {
    list: (offset: number, limit: number): Promise<{ items: SongListItem[]; total: number }> =>
      ipcRenderer.invoke('songs:list', offset, limit),
    detail: (songId: number): Promise<SongDetail | null> => ipcRenderer.invoke('songs:detail', songId),
    update: (songId: number, data: SongUpdateData): Promise<void> =>
      ipcRenderer.invoke('songs:update', songId, data),
    reload: (songId: number, newFileName: string): Promise<ReloadResult> =>
      ipcRenderer.invoke('songs:reload', songId, newFileName),
    setManualCover: (songId: number, imageData: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('songs:setManualCover', songId, imageData),
    cover: (songId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('songs:cover', songId),
    /* 拼 venas-media:// URL 给 <audio> 直接播放，纯字符串操作不需要走 IPC */
    mediaUrl: (fileName: string): string => `venas-media://music/${encodeURIComponent(fileName)}`,
    /* 弹出系统原生文件选择对话框挑选重载用的音频文件，限定只能选 Music/ 目录内的文件，返回相对 Music/ 的文件名；取消时返回 null */
    pickReloadFile: (): Promise<string | null> => ipcRenderer.invoke('songs:pickReloadFile')
  },
  artists: {
    search: (query: string): Promise<ArtistRow[]> => ipcRenderer.invoke('artists:search', query),
    /* 精确匹配（忽略大小写），用于艺术家编辑器判断入库时是关联已有还是新建 */
    matchExact: (name: string): Promise<boolean> => ipcRenderer.invoke('artists:matchExact', name),
    /* Artist 星云第一层网格：全量列表（不含厂牌），附带每人关联曲目数 */
    list: (): Promise<ArtistListItem[]> => ipcRenderer.invoke('artists:list'),
    /* 第二层详情页：艺术家本身信息 + 关联的全部曲目；艺术家不存在返回 null */
    detail: (artistId: number): Promise<{ artist: ArtistRow; songs: SongListItem[] } | null> =>
      ipcRenderer.invoke('artists:detail', artistId),
    /* Artist 星云内"厂牌"分组第一层网格：全量厂牌列表，附带旗下专辑数/曲目数 */
    listLabels: (): Promise<LabelListItem[]> => ipcRenderer.invoke('artists:listLabels'),
    /* 厂牌详情页：厂牌本身信息 + 按专辑分组的全部曲目；厂牌不存在返回 null */
    labelDetail: (labelId: number): Promise<{ label: ArtistRow; groups: LabelAlbumGroup[] } | null> =>
      ipcRenderer.invoke('artists:labelDetail', labelId),
    /* 艺术家/厂牌头像：共用 artists 表与同一套接口 */
    picture: (artistId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('artists:picture', artistId),
    setManualPicture: (artistId: number, imageData: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('artists:setManualPicture', artistId, imageData)
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
    cover: (albumId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('albums:cover', albumId)
  },
  tags: {
    search: (query: string): Promise<TagRow[]> => ipcRenderer.invoke('tags:search', query),
    create: (name: string, tagType: string): Promise<number> => ipcRenderer.invoke('tags:create', name, tagType)
  },
  playback: {
    touchLastHeard: (songId: number): Promise<void> => ipcRenderer.invoke('playback:touchLastHeard', songId)
  },
  library: {
    getRoots: (): Promise<{ musicRoot: string; systemRoot: string }> =>
      ipcRenderer.invoke('library:getRoots'),
    /* 返回 false 表示用户取消；成功选定新目录后主进程会重启应用，不会真正 resolve */
    changeMusicRoot: (): Promise<boolean> => ipcRenderer.invoke('library:changeMusicRoot'),
    /* 会自动把旧 .system 整体搬到新目录再重启，同步等待搬运完成 */
    changeSystemRoot: (): Promise<boolean> => ipcRenderer.invoke('library:changeSystemRoot')
  }
}

export type Api = typeof api

/* contextIsolation 开启时，只能通过 contextBridge 向渲染进程暴露白名单 API */
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
