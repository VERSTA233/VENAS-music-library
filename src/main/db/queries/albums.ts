import type Database from 'better-sqlite3'
import type { AlbumRow, AlbumListItem, AlbumMatchCandidate, SongAlbumDetail, AlbumSongItem } from '../../../shared/types'
import { findOrCreateLabelArtist } from './artists'

export type { AlbumRow }

export interface AlbumArtistInput {
  artistId: number
  order: number
}

/* albums 表 LEFT JOIN artists 拿厂牌名称，供展示/回填表单用；label 本身不是 albums 表的实际列 */
const ALBUM_SELECT = `
  SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
         al.total_discs AS total_discs, al.label_id AS label_id, lb.name AS label
  FROM albums al LEFT JOIN artists lb ON lb.id = al.label_id
`

export function createAlbum(
  db: Database.Database,
  data: { title: string; releaseDate: string | null; albumType: string | null; totalDiscs: number | null; label: string | null }
): number {
  const labelId = data.label ? findOrCreateLabelArtist(db, data.label) : null
  const info = db
    .prepare(
      'INSERT INTO albums (title, release_date, album_type, total_discs, label_id) VALUES (@title, @releaseDate, @albumType, @totalDiscs, @labelId)'
    )
    .run({ title: data.title, releaseDate: data.releaseDate, albumType: data.albumType, totalDiscs: data.totalDiscs, labelId })
  return Number(info.lastInsertRowid)
}

/*
 * 无条件覆盖已有专辑的全部字段。调用前提是前端已经过用户确认（改动确认框选择"应用"），
 * 或字段本就与原值一致（覆盖等于空操作），因此这里不做"仅非空才更新"的旧式合并判断。
 */
export function updateAlbumFields(
  db: Database.Database,
  albumId: number,
  data: { title: string; releaseDate: string | null; albumType: string | null; totalDiscs: number | null; label: string | null }
): void {
  const labelId = data.label ? findOrCreateLabelArtist(db, data.label) : null
  db.prepare(
    'UPDATE albums SET title = @title, release_date = @releaseDate, album_type = @albumType, total_discs = @totalDiscs, label_id = @labelId WHERE id = @albumId'
  ).run({ title: data.title, releaseDate: data.releaseDate, albumType: data.albumType, totalDiscs: data.totalDiscs, labelId, albumId })
}

/* 按标题搜索（含 LIKE 模糊匹配），附带每张专辑的艺术家拼接字符串，供前端红黄绿灯判定与去重下拉框展示用 */
export function searchAlbums(db: Database.Database, query: string): AlbumMatchCandidate[] {
  const rows = db
    .prepare<[string], AlbumRow>(`${ALBUM_SELECT} WHERE al.title LIKE ? COLLATE NOCASE ORDER BY al.title LIMIT 20`)
    .all(`%${query}%`)
  return rows.map((row): AlbumMatchCandidate => {
    const artists = getAlbumArtists(db, row.id)
    return { ...row, artistNames: artists.map((a) => a.name).join(', ') }
  })
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
        label_id: number | null
        label: string | null
        disc_number: number | null
        track_number: number | null
      }
    >(
      `SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
              al.total_discs AS total_discs, al.label_id AS label_id, lb.name AS label,
              als.disc_number AS disc_number, als.track_number AS track_number
       FROM album_songs als JOIN albums al ON al.id = als.album_id
       LEFT JOIN artists lb ON lb.id = al.label_id
       WHERE als.song_id = ?`
    )
    .get(songId)
  if (!row) return null
  return { ...row, artists: getAlbumArtists(db, row.id) }
}

/*
 * Album 画廊第一层网格数据源：附带专辑艺术家拼接字符串、曲目数量，按标题排序。
 * 封面不再依赖代表曲目，前端直接按专辑 id 调 albums:cover 查询 assets/album_pictures/{albumId}.jpg。
 */
export function listAlbums(db: Database.Database): AlbumListItem[] {
  const rows = db
    .prepare<[], AlbumRow & { songCount: number }>(
      `SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
              al.total_discs AS total_discs, al.label_id AS label_id, lb.name AS label,
              COUNT(DISTINCT als.song_id) AS songCount
       FROM albums al
       LEFT JOIN artists lb ON lb.id = al.label_id
       LEFT JOIN album_songs als ON als.album_id = al.id
       GROUP BY al.id
       ORDER BY al.title COLLATE NOCASE`
    )
    .all()

  return rows.map((row): AlbumListItem => {
    const artists = getAlbumArtists(db, row.id)
    return { ...row, artistNames: artists.map((a) => a.name).join(', ') }
  })
}

export function getAlbumById(db: Database.Database, albumId: number): AlbumRow | null {
  const row = db.prepare<[number], AlbumRow>(`${ALBUM_SELECT} WHERE al.id = ?`).get(albumId)
  return row ?? null
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
        disc_number: number | null
        track_number: number | null
      }
    >(
      `SELECT s.id AS id, s.title AS title, s.length AS length, s.file_name AS file_name,
              als.disc_number AS disc_number, als.track_number AS track_number
       FROM album_songs als JOIN songs s ON s.id = als.song_id
       WHERE als.album_id = ?
       ORDER BY als.disc_number ASC, als.track_number ASC`
    )
    .all(albumId)

  const artistStmt = db.prepare<[number], { name: string }>(
    `SELECT ar.name AS name
     FROM song_artists sa JOIN artists ar ON ar.id = sa.artist_id
     WHERE sa.song_id = ? ORDER BY sa.artist_order ASC`
  )

  return rows.map((row): AlbumSongItem => {
    const artistRows = artistStmt.all(row.id)
    return { ...row, artistNames: artistRows.map((a) => a.name).join(', ') }
  })
}
