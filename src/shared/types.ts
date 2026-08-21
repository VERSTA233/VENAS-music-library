/*
 * 主进程与渲染进程共享的 IPC 边界类型。
 * 只放跨进程传输会用到的形状，不引入任何 Node/Electron 专属依赖，
 * 这样 tsconfig.node.json 和 tsconfig.web.json 两个 composite 工程都能直接引用。
 */

export interface AppendEntry {
  fileName: string
  title: string
  artist: string | null
  album: string | null
  /* 专辑艺术家（多见于合集/OST，与主艺术家字段不同），用于入库时自动识别专辑艺术家 */
  albumArtist: string | null
  /* 厂牌，保留音频文件 label 字段中的全部值。 */
  labels: string[]
  /* 兼容旧版持久化播放会话；新扫描结果不再写入。 */
  label?: string | null
  /* 与音频文件同名的 .lrc 文件内容（如 "X.flac" 对应 "X.lrc"），自动匹配填充；未找到对应文件时为 null */
  lyric: string | null
  /* 自动匹配到的歌词文件绝对路径，供入库成功后自动删除该文件；未匹配到时为 null */
  lyricFilePath: string | null
  releaseDate: string | null
  discNumber: number | null
  totalDiscs: number | null
  trackNumber: number | null
  duration: number | null
  hasPicture: boolean
}

/* 网易云音乐导入的处理结果。audioFiles 仅包含本次已成功进入 Append 的音频文件。 */
export interface NeteaseImportResult {
  audioFiles: string[]
  failedFiles: { fileName: string; message: string }[]
}

/* 应用重启后恢复到底部播放器的会话；mediaUrl 是已注册的 venas-media 协议地址，可直接继续使用。 */
export interface PlaybackSession {
  queue: {
    key: string
    title: string
    artistNames: string
    mediaUrl: string
    songId: number | null
    appendEntry: AppendEntry | null
  }[]
  currentIndex: number
  currentTime: number
  playbackMode: 'sequential' | 'shuffle'
  shuffleOrder: number[]
}

export type NavigationView = 'append' | 'music' | 'artist' | 'album' | 'tag' | 'settings'

export type NavigationTarget =
  | { view: 'artist'; id: number; isLabel: boolean }
  | { view: 'album'; id: number }
  | { view: 'tag'; id: number; parentType?: string }
  | { view: 'tagType'; tagType: string }

/* 只恢复页面层级，不保存搜索词、弹窗和编辑状态。 */
export interface NavigationSession {
  view: NavigationView
  target: NavigationTarget | null
}

/* 更换音乐目录前的只读扫描结果。missingFiles 均为当前数据库记录、但目标 Music/ 中不存在的文件名。 */
export interface MusicRootInspection {
  musicRoot: string
  totalSongs: number
  missingFiles: string[]
}

export interface MissingAudioFile {
  songId: number
  title: string
  fileName: string
}

export interface MissingSongCover {
  songId: number
  title: string
  fileName: string
  coverKind: 'song' | 'album'
  coverId: number
}

export interface OrphanPictureFiles {
  artist: string[]
  song: string[]
  album: string[]
}

export interface ParsedArtist {
  name: string
  role: 'Primary' | 'Featured'
  order: number
}

export interface IngestArtistInput {
  name: string
  role: string
  order: number
  /* 用户为新艺术家（未匹配数据库，即将新建）指定的类型，仅在新建时写入；已匹配到已有艺术家时忽略此字段 */
  type: 'Person' | 'Group' | null
}

export interface IngestTagInput {
  /* 已有 Tag 传 id；新建 Tag 传 { name, tagType } */
  id?: number
  name?: string
  tagType?: string
}

export interface IngestAlbumInput {
  /* 专辑可选：不填则不建立专辑关联，单曲直接入库 */
  title: string
  releaseDate: string | null
  albumType: string | null
  /* 专辑总碟数：描述整张专辑的属性，不随单曲变化，多首歌同入一张专辑时后写入的会覆盖前面的 */
  totalDiscs: number | null
  /* 专辑厂牌名称，写库时逐项匹配或创建 type='Label' 的 artist；空数组表示清空。 */
  labels: string[]
  discNumber: number | null
  trackNumber: number | null
  /*
   * 专辑艺术家：从音频文件自身的 albumartist 字段提取（与歌曲艺术家来源的 artist 字段是两个不同字段），
   * 复用 IngestArtistInput 结构只是为了共享艺术家编辑组件，role 在专辑艺术家场景下始终不展示、不可编辑
   * （album_artists 表本身没有 role 列，只有顺序）
   */
  artists: IngestArtistInput[]
  /*
   * 前端已确认使用的专辑 id：来自下拉框显式选定，或去重确认框/改动确认框走完流程后的结果。
   * null 表示新建一张专辑（标题为空时忽略，不建立专辑关联）。
   */
  albumId: number | null
}

export interface IngestRequest {
  fileName: string // Append/ 下的原始文件名
  /* 用户在表单中最终确认的 Music/ 下文件名，默认预填 fileName（原始文件名），用户可自由编辑 */
  targetFileName: string
  title: string
  /* 用户手动登记的初次聆听日期（YYYY-MM-DD），不填为 null */
  firstHeardDate: string | null
  lyric: string | null
  /* 用户通过系统文件选择对话框选定的歌词文件绝对路径（可能不在 Append 目录内），入库成功后会自动删除该文件；不导入歌词时为 null */
  lyricFilePath: string | null
  artists: IngestArtistInput[]
  tags: IngestTagInput[]
  album: IngestAlbumInput | null
  /* 用户评分（0-100），不填为 null */
  score: number | null
  comment: string | null
}

export interface IngestResult {
  songId: number
  /* 封面缓存写入失败时为 true：歌曲本身已正确入库，仅缺少列表缩略图，可通过“重载音频文件”重试 */
  coverCacheFailed: boolean
}

export interface ReloadResult {
  /* 新文件没有内嵌封面，或封面缓存写入失败：需要提示用户可手动上传封面图片兜底 */
  coverCacheFailed: boolean
  fileName: string
  /* true 表示音频内容已替换，播放器需要加载新媒体；纯文件名修改为 false。 */
  audioReplaced: boolean
}

export interface ReloadFileSelection {
  /* 主进程文件选择器返回的绝对路径，仅在保存歌曲信息时传回主进程。 */
  filePath: string
  fileName: string
}

export interface SongListItem {
  id: number
  title: string
  length: number | null
  file_name: string
  /* 音频文件的添加时间，用于歌曲列表按添加时间排序；历史数据可能为空。 */
  add_time: string | null
  artistNames: string // 拼接后的显示用字符串，如 "Sakuzyo / Xi"
}

export type SongListSort = 'library' | 'title' | 'addedAt'

export interface AlbumLabel {
  id: number
  name: string
  order: number
}

/* 歌曲所属专辑的详情，含这首歌在专辑内的碟号/曲目号与专辑艺术家列表 */
export interface SongAlbumDetail {
  id: number
  title: string
  release_date: string | null
  album_type: string | null
  total_discs: number | null
  labels: AlbumLabel[]
  /* 曲目号/碟号均可留空不填，为 null 表示未登记 */
  disc_number: number | null
  track_number: number | null
  artists: { id: number; name: string; order: number }[]
}

export interface SongDetail {
  id: number
  title: string
  length: number | null
  lyric: string | null
  file_name: string
  /* 音频文件本身的创建时间（入库时读取），而非执行入库操作的时刻 */
  add_time: string | null
  /* 用户手动登记的初次聆听日期，非系统自动写入 */
  first_heard_date: string | null
  /* 播放完成或超过阈值时系统自动更新 */
  last_heard_date: string | null
  /* 用户评分（0-100），不填为 null */
  score: number | null
  comment: string | null
  artists: { id: number; name: string; role: string; order: number }[]
  tags: { id: number; name: string; tag_type: string | null }[]
  /* 不属于任何专辑（单曲直接入库）时为 null */
  album: SongAlbumDetail | null
}

/* 渲染进程更新歌曲信息时提交的数据结构，对应 songs:update handler 的参数 */
export interface SongUpdateData {
  title: string
  /* Music/ 根目录中的目标音频文件名（包含扩展名）；可只改名，也可作为替换音频的最终名称。 */
  fileName: string
  /* 编辑歌曲时选定的替换音频绝对路径；保存时移动进 Music，null 表示不替换。 */
  replacementFilePath: string | null
  /* 用户手动登记的初次聆听日期（YYYY-MM-DD），不填为 null */
  firstHeardDate: string | null
  lyric: string | null
  /* 用户在编辑歌曲时通过选择器导入的歌词源文件；更新成功后删除，null 表示不关联源文件 */
  lyricFilePath: string | null
  artists: { name: string; role: string; order: number; type: 'Person' | 'Group' | null }[]
  tagIds: number[]
  /* null 表示不属于任何专辑（若歌曲此前有专辑关联，会被解除） */
  album: IngestAlbumInput | null
  /* 用户评分（0-100），不填为 null */
  score: number | null
  comment: string | null
}

export interface ArtistRow {
  id: number
  name: string
  type: string | null
  country: string | null
  member_ids: string | null
}

export type ArtistAliasType = 'alias' | 'former name'

/* 当前艺术家是别名时，其对应的主艺名信息。 */
export interface ArtistAliasOf {
  id: number
  name: string
  aliasType: ArtistAliasType | null
}

/* 艺术家编辑弹窗保存用；type 缺省时保留厂牌的 Label 类型。 */
export interface ArtistUpdateData {
  name: string
  type?: 'Person' | 'Group' | null
  country: string | null
  /* Group/Label 的有序成员列表；Person/未分类艺术家保存时会清空该字段。 */
  memberIds: number[]
}

export interface TagUpdateData {
  name: string
  tagType: string | null
}

/* Artist 星云第一层网格用：附带该艺术家关联的歌曲数量 */
export interface ArtistListItem extends ArtistRow {
  songCount: number
}

export type ArtistListSort = 'library' | 'name' | 'count'

export interface TagRow {
  id: number
  name: string
  tag_type: string | null
  description: string | null
}

/* Tag 分类导航第一层用：全部 tag_type 分组，附带该类型下的 Tag 数量 */
export interface TagTypeItem {
  tag_type: string
  tagCount: number
}

/* Tag 分类导航第二层用：某个类型下的全部 Tag，附带该 Tag 关联的歌曲数量 */
export interface TagListItem extends TagRow {
  songCount: number
}

/* Tag 详情页（第三层）曲目列表项：附带该曲目在这个 Tag 下的备注（song_tags.comment，与 Tag 一一对应，非歌曲全局属性） */
export interface TagSongItem extends SongListItem {
  comment: string | null
  /* song_tags 中的持久化顺序，Tag 详情页按此字段展示并支持拖拽调整。 */
  sort_order: number
}

export interface AlbumRow {
  id: number
  title: string
  release_date: string | null
  album_type: string | null
  total_discs: number | null
  labels: AlbumLabel[]
}

export interface AlbumUpdateData {
  title: string
  releaseDate: string | null
  albumType: string | null
  totalDiscs: number | null
  labels: string[]
  artists: { name: string; order: number; type: 'Person' | 'Group' | null }[]
}

/* 同名专辑去重下拉框用：附带专辑艺术家拼接字符串，供用户在多个同名专辑间辨认选择 */
export interface AlbumMatchCandidate extends AlbumRow {
  artistNames: string
}

/* Album 画廊第一层网格用：附带专辑艺术家拼接字符串、曲目数量；封面按专辑 id 通过 albums:cover 单独查询 */
export interface AlbumListItem extends AlbumRow {
  artistNames: string
  songCount: number
}

export type AlbumListSort = 'library' | 'title' | 'count'

/* Artist/Album 二级详情页曲目列表项：在 SongListItem 基础上附带专辑内的碟号/曲目号（Album 详情页排序、展示用；Artist 详情页恒为 null） */
export interface AlbumSongItem extends SongListItem {
  disc_number: number | null
  track_number: number | null
}

/* Artist 星云内"厂牌"分组第一层网格用：厂牌本质上是 type='Label' 的 artists 记录，附带旗下专辑数/曲目数 */
export interface LabelListItem extends ArtistRow {
  albumCount: number
  songCount: number
}

/* 厂牌详情页：按专辑分组展示旗下全部曲目，每组含专辑本身信息与按碟号/曲目号排好序的曲目列表 */
export interface LabelAlbumGroup {
  album: AlbumRow
  songs: AlbumSongItem[]
}
