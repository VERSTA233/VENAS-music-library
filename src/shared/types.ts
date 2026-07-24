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
  /* 厂牌，来自音频文件自身的 label 字段，用于入库时自动识别专辑厂牌 */
  label: string | null
  /* 来自音频文件自身的 bpm 字段，用于入库表单自动预填 */
  bpm: number | null
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

export interface ParsedArtist {
  name: string
  role: 'Primary' | 'Featured'
  order: number
}

export interface IngestArtistInput {
  name: string
  role: string
  order: number
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
  /*
   * 专辑厂牌：本质上也是一个 artist（type='Label'），这里只传名称，写库时按名称 findOrCreateArtist，
   * 新建时自动打上 type='Label'。null 表示不设置/不修改厂牌
   */
  label: string | null
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
  bpm: number | null
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
}

export interface SongListItem {
  id: number
  title: string
  length: number | null
  file_name: string
  artistNames: string // 拼接后的显示用字符串，如 "Sakuzyo, Xi"
}

/* 歌曲所属专辑的详情，含这首歌在专辑内的碟号/曲目号与专辑艺术家列表 */
export interface SongAlbumDetail {
  id: number
  title: string
  release_date: string | null
  album_type: string | null
  total_discs: number | null
  label_id: number | null
  label: string | null
  /* 曲目号/碟号均可留空不填，为 null 表示未登记 */
  disc_number: number | null
  track_number: number | null
  artists: { id: number; name: string; order: number }[]
}

export interface SongDetail {
  id: number
  title: string
  length: number | null
  bpm: number | null
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
  bpm: number | null
  /* 用户手动登记的初次聆听日期（YYYY-MM-DD），不填为 null */
  firstHeardDate: string | null
  lyric: string | null
  artists: { name: string; role: string; order: number }[]
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

/* Artist 星云第一层网格用：附带该艺术家关联的歌曲数量 */
export interface ArtistListItem extends ArtistRow {
  songCount: number
}

export interface TagRow {
  id: number
  name: string
  tag_type: string | null
  description: string | null
}

export interface AlbumRow {
  id: number
  title: string
  release_date: string | null
  album_type: string | null
  total_discs: number | null
  /* 厂牌 artist 的 id，albums 表实际存储的列 */
  label_id: number | null
  /* 厂牌名称：LEFT JOIN artists 得到，不是 albums 表实际列，仅供展示/回填表单用 */
  label: string | null
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
