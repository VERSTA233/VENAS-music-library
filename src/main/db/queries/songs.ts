import type Database from 'better-sqlite3'
import type { SongListItem, SongDetail, SongListSort, SortDirection } from '../../../shared/types'
import { buildSearchTerms } from '../../../shared/searchTerms'
import { getSongAlbum } from './albums'
import { withArtistNames } from './songList'

export type { SongListItem, SongDetail }

export interface SongArtistInput {
  artistId: number
  role: string
  order: number
}

/* 查询完整 Music 库歌曲列表，含拼装好的艺术家显示字符串（按 role=Primary 优先、artist_order 排序）。 */
export function listSongs(db: Database.Database, sort: SongListSort = 'library', query = '', direction: SortDirection = 'desc'): SongListItem[] {
  const normalizedSort: SongListSort = sort === 'title' || sort === 'addedAt' ? sort : 'library'
  const normalizedDirection: SortDirection = direction === 'asc' ? 'asc' : 'desc'
  const order = normalizedDirection === 'asc' ? 'ASC' : 'DESC'
  const orderBy = {
    library: `s.id ${order}`,
    title: `s.title COLLATE NOCASE ${order}, s.id ${order}`,
    addedAt: `si.add_time IS NULL ASC, si.add_time ${order}, s.id ${order}`
  }[normalizedSort]
  const search = buildSongSearch(query)
  const rows = db.prepare(
    `SELECT s.id, s.title, s.length, s.file_name, si.add_time
       FROM songs s
       LEFT JOIN song_info si ON si.song_id = s.id
       WHERE ${search.where}
       ORDER BY ${orderBy}`
  ).all(search.parameters) as { id: number; title: string; length: number | null; file_name: string; add_time: string | null }[]

  return withArtistNames(db, rows)
}

export function countSongs(db: Database.Database, query = ''): number {
  const search = buildSongSearch(query)
  const row = db.prepare(`SELECT COUNT(*) AS count FROM songs s WHERE ${search.where}`).get(search.parameters) as { count: number } | undefined
  return row?.count ?? 0
}

/* 关键词同时匹配曲名、歌曲艺术家、专辑名、厂牌；罗马字额外转换为平假名和片假名后参与同一查询。 */
function buildSongSearch(query: string): { where: string; parameters: Record<string, string> } {
  const source = query.trim()
  if (!source) return { where: '1 = 1', parameters: {} }

  const terms = buildSearchTerms(source)
  const parameters: Record<string, string> = {}
  const clauses = terms.map((term, index) => {
    const key = `search${index}`
    parameters[key] = `%${term}%`
    return `(s.title LIKE @${key} COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM song_artists sa
        JOIN artists ar ON ar.id = sa.artist_id
        WHERE sa.song_id = s.id
          AND (
            ar.name LIKE @${key} COLLATE NOCASE
          )
      )
      OR EXISTS (
        SELECT 1 FROM album_songs als
        JOIN albums al ON al.id = als.album_id
        WHERE als.song_id = s.id
          AND (
            al.title LIKE @${key} COLLATE NOCASE
            OR EXISTS (
              SELECT 1 FROM album_labels abl
              JOIN artists lb ON lb.id = abl.label_id
              WHERE abl.album_id = al.id AND lb.name LIKE @${key} COLLATE NOCASE
            )
          )
      ))`
  })
  return { where: clauses.join(' OR '), parameters }
}

/* 供目录迁移前的只读一致性扫描使用；不加载歌曲详情或艺术家关联，避免不必要的查询。 */
export function listSongFileNames(db: Database.Database): string[] {
  return db.prepare<[], { file_name: string }>('SELECT file_name FROM songs ORDER BY file_name COLLATE NOCASE').all().map((row) => row.file_name)
}

export function getSongDetail(db: Database.Database, songId: number): SongDetail | null {
  const song = db
    .prepare<
      [number],
      {
        id: number
        title: string
        length: number | null
        lyric: string | null
        file_name: string
        add_time: string | null
        first_heard_date: string | null
        last_heard_date: string | null
        score: number | null
        comment: string | null
      }
    >(
      `SELECT s.id AS id, s.title AS title, s.length AS length, s.lyric AS lyric, s.file_name AS file_name,
              si.add_time AS add_time, si.first_heard_date AS first_heard_date, si.last_heard_date AS last_heard_date,
              si.score AS score, si.comment AS comment
       FROM songs s LEFT JOIN song_info si ON si.song_id = s.id
       WHERE s.id = ?`
    )
    .get(songId)
  if (!song) return null

  const artists = db
    .prepare<[number], { id: number; name: string; role: string; order: number }>(
      `SELECT ar.id AS id, ar.name AS name, sa.role AS role, sa.artist_order AS "order"
       FROM song_artists sa JOIN artists ar ON ar.id = sa.artist_id
       WHERE sa.song_id = ? ORDER BY sa.artist_order ASC`
    )
    .all(songId)

  const tags = db
    .prepare<[number], { id: number; name: string; tag_type: string | null }>(
      `SELECT t.id AS id, t.name AS name, t.tag_type AS tag_type
       FROM song_tags st JOIN tags t ON t.id = st.tag_id
       WHERE st.song_id = ?`
    )
    .all(songId)

  const album = getSongAlbum(db, songId)

  return { ...song, artists, tags, album }
}

export function createSong(
  db: Database.Database,
  data: { title: string; length: number | null; lyric: string | null; file_name: string }
): number {
  const info = db
    .prepare('INSERT INTO songs (title, length, lyric, file_name) VALUES (@title, @length, @lyric, @file_name)')
    .run(data)
  return Number(info.lastInsertRowid)
}

export function setSongArtists(db: Database.Database, songId: number, artists: SongArtistInput[]): void {
  db.prepare('DELETE FROM song_artists WHERE song_id = ?').run(songId)
  const stmt = db.prepare(
    'INSERT INTO song_artists (song_id, artist_id, role, artist_order) VALUES (?, ?, ?, ?)'
  )
  for (const a of artists) {
    stmt.run(songId, a.artistId, a.role, a.order)
  }
}

export function setSongTags(db: Database.Database, songId: number, tagIds: number[]): void {
  const uniqueTagIds = [...new Set(tagIds)]
  if (uniqueTagIds.length === 0) {
    db.prepare('DELETE FROM song_tags WHERE song_id = ?').run(songId)
    return
  }

  /* 保留仍被选中的既有关联，避免编辑歌曲资料时清空 Tag 页维护的顺序和评论。 */
  const placeholders = uniqueTagIds.map(() => '?').join(', ')
  db.prepare(`DELETE FROM song_tags WHERE song_id = ? AND tag_id NOT IN (${placeholders})`).run(songId, ...uniqueTagIds)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO song_tags (song_id, tag_id, sort_order)
     SELECT ?, ?, COALESCE(MAX(sort_order) + 1, 0) FROM song_tags WHERE tag_id = ?`
  )
  for (const tagId of uniqueTagIds) insert.run(songId, tagId, tagId)
}

export function updateSongFields(
  db: Database.Database,
  songId: number,
  data: Partial<{ title: string; lyric: string | null; length: number | null; file_name: string }>
): void {
  const fields = Object.keys(data)
  if (fields.length === 0) return
  const setClause = fields.map((f) => `${f} = @${f}`).join(', ')
  db.prepare(`UPDATE songs SET ${setClause} WHERE id = @id`).run({ ...data, id: songId })
}

export function deleteSong(db: Database.Database, songId: number): void {
  db.prepare('DELETE FROM songs WHERE id = ?').run(songId)
}

export function isFileNameTaken(db: Database.Database, fileName: string): boolean {
  const row = db.prepare<[string], { id: number }>('SELECT id FROM songs WHERE file_name = ?').get(fileName)
  return !!row
}
