import type Database from 'better-sqlite3'
import type { SongListItem, SongDetail } from '../../../shared/types'
import { getSongAlbum } from './albums'

export type { SongListItem, SongDetail }

export interface SongArtistInput {
  artistId: number
  role: string
  order: number
}

/* 分页查询 Music 库歌曲列表，含拼装好的艺术家显示字符串（按 role=Primary 优先、artist_order 排序） */
export function listSongs(db: Database.Database, offset: number, limit: number): SongListItem[] {
  const rows = db
    .prepare<
      [number, number],
      { id: number; title: string; length: number | null; file_name: string }
    >('SELECT id, title, length, file_name FROM songs ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset)

  const artistStmt = db.prepare<[number], { name: string }>(
    `SELECT ar.name AS name
     FROM song_artists sa
     JOIN artists ar ON ar.id = sa.artist_id
     WHERE sa.song_id = ?
     ORDER BY sa.artist_order ASC`
  )

  return rows.map((row) => {
    const artistRows = artistStmt.all(row.id)
    return { ...row, artistNames: artistRows.map((a) => a.name).join(', ') }
  })
}

export function countSongs(db: Database.Database): number {
  const row = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM songs').get()
  return row?.count ?? 0
}

export function getSongDetail(db: Database.Database, songId: number): SongDetail | null {
  const song = db
    .prepare<
      [number],
      {
        id: number
        title: string
        length: number | null
        bpm: number | null
        lyric: string | null
        file_name: string
        add_time: string | null
        first_heard_date: string | null
        last_heard_date: string | null
        score: number | null
        comment: string | null
      }
    >(
      `SELECT s.id AS id, s.title AS title, s.length AS length, s.bpm AS bpm, s.lyric AS lyric, s.file_name AS file_name,
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
  data: { title: string; length: number | null; bpm: number | null; lyric: string | null; file_name: string }
): number {
  const info = db
    .prepare('INSERT INTO songs (title, length, bpm, lyric, file_name) VALUES (@title, @length, @bpm, @lyric, @file_name)')
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
  db.prepare('DELETE FROM song_tags WHERE song_id = ?').run(songId)
  const stmt = db.prepare('INSERT INTO song_tags (song_id, tag_id) VALUES (?, ?)')
  for (const tagId of tagIds) {
    stmt.run(songId, tagId)
  }
}

export function updateSongFields(
  db: Database.Database,
  songId: number,
  data: Partial<{ title: string; bpm: number | null; lyric: string | null; length: number | null; file_name: string }>
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
