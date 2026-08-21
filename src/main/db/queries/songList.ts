import type Database from 'better-sqlite3'

/* 给已取回的歌曲行批量附加艺术家显示名，避免每首歌再发起一次查询。 */
export function withArtistNames<T extends { id: number }>(db: Database.Database, rows: T[]): (T & { artistNames: string })[] {
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(', ')
  const artistRows = db
    .prepare<(number)[], { song_id: number; name: string }>(
      `SELECT sa.song_id, ar.name AS name
       FROM song_artists sa
       JOIN artists ar ON ar.id = sa.artist_id
       WHERE sa.song_id IN (${placeholders})
       ORDER BY sa.song_id ASC, sa.artist_order ASC`
    )
    .all(...ids)

  const namesBySongId = new Map<number, string[]>()
  for (const artist of artistRows) {
    const names = namesBySongId.get(artist.song_id) ?? []
    names.push(artist.name)
    namesBySongId.set(artist.song_id, names)
  }

  return rows.map((row) => ({ ...row, artistNames: (namesBySongId.get(row.id) ?? []).join(' / ') }))
}
