import type Database from 'better-sqlite3'
import type { AlbumRow, AlbumLabel, AlbumListItem, AlbumMatchCandidate, SongAlbumDetail, AlbumSongItem } from '../../../shared/types'
import { findOrCreateLabelArtist } from './artists'
import { withArtistNames } from './songList'

export type { AlbumRow }

export interface AlbumArtistInput {
  artistId: number
  order: number
}

type AlbumBaseRow = Omit<AlbumRow, 'labels'>

const ALBUM_SELECT = `
  SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
         al.total_discs AS total_discs
  FROM albums al
`

export function getAlbumLabels(db: Database.Database, albumId: number): AlbumLabel[] {
  return db
    .prepare<[number], AlbumLabel>(
      `SELECT ar.id AS id, ar.name AS name, abl.label_order AS "order"
       FROM album_labels abl
       JOIN artists ar ON ar.id = abl.label_id
       WHERE abl.album_id = ?
       ORDER BY abl.label_order ASC, ar.id ASC`
    )
    .all(albumId)
}

/* 覆盖专辑全部厂牌；名称忽略大小写去重，保留用户给出的顺序。 */
export function setAlbumLabels(db: Database.Database, albumId: number, labels: string[]): void {
  const normalizedLabels: string[] = []
  const seen = new Set<string>()
  for (const source of labels) {
    const name = source.trim()
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    normalizedLabels.push(name)
  }

  db.transaction(() => {
    db.prepare('DELETE FROM album_labels WHERE album_id = ?').run(albumId)
    const insert = db.prepare('INSERT INTO album_labels (album_id, label_id, label_order) VALUES (?, ?, ?)')
    for (const [order, name] of normalizedLabels.entries()) {
      insert.run(albumId, findOrCreateLabelArtist(db, name), order)
    }
  })()
}

export function createAlbum(
  db: Database.Database,
  data: { title: string; releaseDate: string | null; albumType: string | null; totalDiscs: number | null; labels: string[] }
): number {
  const info = db
    .prepare(
      'INSERT INTO albums (title, release_date, album_type, total_discs) VALUES (@title, @releaseDate, @albumType, @totalDiscs)'
    )
    .run({ title: data.title, releaseDate: data.releaseDate, albumType: data.albumType, totalDiscs: data.totalDiscs })
  const albumId = Number(info.lastInsertRowid)
  setAlbumLabels(db, albumId, data.labels)
  return albumId
}

/*
 * 无条件覆盖已有专辑的全部字段。调用前提是前端已经过用户确认（改动确认框选择"应用"），
 * 或字段本就与原值一致（覆盖等于空操作），因此这里不做"仅非空才更新"的旧式合并判断。
 */
export function updateAlbumFields(
  db: Database.Database,
  albumId: number,
  data: { title: string; releaseDate: string | null; albumType: string | null; totalDiscs: number | null; labels: string[] }
): void {
  db.prepare(
    'UPDATE albums SET title = @title, release_date = @releaseDate, album_type = @albumType, total_discs = @totalDiscs WHERE id = @albumId'
  ).run({ title: data.title, releaseDate: data.releaseDate, albumType: data.albumType, totalDiscs: data.totalDiscs, albumId })
  setAlbumLabels(db, albumId, data.labels)
}

/*
 * 按标题搜索（含 LIKE 模糊匹配），附带每张专辑的艺术家拼接字符串，供前端红黄绿灯判定与去重下拉框展示用。
 * 候选数量有限时，完全同名和前缀匹配必须排在普通包含匹配前面；否则单字符标题（例如 U）会被大量
 * 名称中恰好含该字符的专辑挤出前 20 条，导致入库时无法选择已有专辑。
 */
export function searchAlbums(db: Database.Database, query: string): AlbumMatchCandidate[] {
  const rows = db
    .prepare<[string, string, string], AlbumBaseRow>(
      `${ALBUM_SELECT}
       WHERE al.title LIKE ? COLLATE NOCASE
       ORDER BY CASE
         WHEN al.title = ? COLLATE NOCASE THEN 0
         WHEN al.title LIKE ? COLLATE NOCASE THEN 1
         ELSE 2
       END,
       al.title COLLATE NOCASE
       LIMIT 20`
    )
    .all(`%${query}%`, query, `${query}%`)
  return withAlbumArtistNames(db, withAlbumLabels(db, rows))
}

/* 建立/覆盖 song 在某专辑内的曲目位置（一首歌同一时刻只属于一张专辑，重复入库时先清旧关联）；碟号/曲目号均可留空不填 */
export function setSongAlbum(
  db: Database.Database,
  songId: number,
  albumId: number,
  discNumber: number | null,
  trackNumber: number | null
): void {
  db.prepare('DELETE FROM album_songs WHERE song_id = ?').run(songId)
  db.prepare(
    'INSERT INTO album_songs (album_id, song_id, disc_number, track_number) VALUES (?, ?, ?, ?)'
  ).run(albumId, songId, discNumber, trackNumber)
}

/* 解除某首歌与专辑的关联（编辑时把专辑名清空表示不再属于任何专辑），不删除专辑本身 */
export function removeSongAlbum(db: Database.Database, songId: number): void {
  db.prepare('DELETE FROM album_songs WHERE song_id = ?').run(songId)
}

export function getAlbumArtists(db: Database.Database, albumId: number): { id: number; name: string; order: number }[] {
  return db
    .prepare<[number], { id: number; name: string; order: number }>(
      `SELECT ar.id AS id, ar.name AS name, aa.artist_order AS "order"
       FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
       WHERE aa.album_id = ? ORDER BY aa.artist_order ASC`
    )
    .all(albumId)
}

/* 覆盖某张专辑的艺术家列表（先清后插） */
export function setAlbumArtists(db: Database.Database, albumId: number, artists: AlbumArtistInput[]): void {
  db.prepare('DELETE FROM album_artists WHERE album_id = ?').run(albumId)
  const stmt = db.prepare('INSERT INTO album_artists (album_id, artist_id, artist_order) VALUES (?, ?, ?)')
  for (const a of artists) {
    stmt.run(albumId, a.artistId, a.order)
  }
}

/* 查询某首歌所属专辑的完整信息（含该歌在专辑内的碟号/曲目号、专辑艺术家），不属于任何专辑返回 null */
export function getSongAlbum(db: Database.Database, songId: number): SongAlbumDetail | null {
  const row = db
    .prepare<
      [number],
      {
        id: number
        title: string
        release_date: string | null
        album_type: string | null
        total_discs: number | null
        disc_number: number | null
        track_number: number | null
      }
    >(
      `SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
              al.total_discs AS total_discs,
              als.disc_number AS disc_number, als.track_number AS track_number
       FROM album_songs als JOIN albums al ON al.id = als.album_id
       WHERE als.song_id = ?`
    )
    .get(songId)
  if (!row) return null
  return { ...row, labels: getAlbumLabels(db, row.id), artists: getAlbumArtists(db, row.id) }
}

/*
 * Album 画廊第一层网格数据源：附带专辑艺术家拼接字符串、曲目数量，按标题排序。
 * 封面不再依赖代表曲目，前端直接按专辑 id 调 albums:cover 查询 assets/album_pictures/{albumId}.jpg。
 */
export function listAlbums(db: Database.Database): AlbumListItem[] {
  const rows = db
    .prepare<[], AlbumBaseRow & { songCount: number }>(
      `SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
              al.total_discs AS total_discs,
              COUNT(DISTINCT als.song_id) AS songCount
       FROM albums al
       LEFT JOIN album_songs als ON als.album_id = al.id
       GROUP BY al.id
       ORDER BY al.title COLLATE NOCASE`
    )
    .all()

  return withAlbumArtistNames(db, withAlbumLabels(db, rows))
}

export function getAlbumById(db: Database.Database, albumId: number): AlbumRow | null {
  const row = db.prepare<[number], AlbumBaseRow>(`${ALBUM_SELECT} WHERE al.id = ?`).get(albumId)
  return row ? { ...row, labels: getAlbumLabels(db, albumId) } : null
}

/* 专辑详情页曲目列表：按 disc_number、track_number 严格升序排列（规格 §4.3 视图 D 要求） */
export function getAlbumSongs(db: Database.Database, albumId: number): AlbumSongItem[] {
  const rows = db
    .prepare<
      [number],
      {
        id: number
        title: string
        length: number | null
        file_name: string
        add_time: string | null
        disc_number: number | null
        track_number: number | null
      }
    >(
      `SELECT s.id AS id, s.title AS title, s.length AS length, s.file_name AS file_name, si.add_time AS add_time,
              als.disc_number AS disc_number, als.track_number AS track_number
       FROM album_songs als JOIN songs s ON s.id = als.song_id
       LEFT JOIN song_info si ON si.song_id = s.id
       WHERE als.album_id = ?
       ORDER BY als.disc_number ASC, als.track_number ASC`
    )
    .all(albumId)

  return withArtistNames(db, rows)
}

/* 给专辑列表批量附加专辑艺术家显示名，避免一张专辑一次 getAlbumArtists 查询。 */
function withAlbumArtistNames<T extends { id: number }>(db: Database.Database, rows: T[]): (T & { artistNames: string })[] {
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(', ')
  const artistRows = db
    .prepare<(number)[], { album_id: number; name: string }>(
      `SELECT aa.album_id, ar.name
       FROM album_artists aa
       JOIN artists ar ON ar.id = aa.artist_id
       WHERE aa.album_id IN (${placeholders})
       ORDER BY aa.album_id ASC, aa.artist_order ASC`
    )
    .all(...ids)
  const namesByAlbumId = new Map<number, string[]>()
  for (const artist of artistRows) {
    const names = namesByAlbumId.get(artist.album_id) ?? []
    names.push(artist.name)
    namesByAlbumId.set(artist.album_id, names)
  }
  return rows.map((row) => ({ ...row, artistNames: (namesByAlbumId.get(row.id) ?? []).join(' / ') }))
}

export function withAlbumLabels<T extends { id: number }>(db: Database.Database, rows: T[]): (T & { labels: AlbumLabel[] })[] {
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(', ')
  const labelRows = db
    .prepare<number[], { album_id: number; id: number; name: string; order: number }>(
      `SELECT abl.album_id AS album_id, ar.id AS id, ar.name AS name, abl.label_order AS "order"
       FROM album_labels abl
       JOIN artists ar ON ar.id = abl.label_id
       WHERE abl.album_id IN (${placeholders})
       ORDER BY abl.album_id ASC, abl.label_order ASC, ar.id ASC`
    )
    .all(...ids)
  const labelsByAlbumId = new Map<number, AlbumLabel[]>()
  for (const label of labelRows) {
    const labels = labelsByAlbumId.get(label.album_id) ?? []
    labels.push({ id: label.id, name: label.name, order: label.order })
    labelsByAlbumId.set(label.album_id, labels)
  }
  return rows.map((row) => ({ ...row, labels: labelsByAlbumId.get(row.id) ?? [] }))
}
