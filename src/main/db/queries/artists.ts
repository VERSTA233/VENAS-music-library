import type Database from 'better-sqlite3'
import type { ArtistRow, ArtistListItem, SongListItem } from '../../../shared/types'

export type { ArtistRow }

/* 按名称精确匹配（忽略大小写），无匹配返回 null */
export function findArtistByName(db: Database.Database, name: string): ArtistRow | null {
  const row = db
    .prepare<[string], ArtistRow>('SELECT * FROM artists WHERE name = ? COLLATE NOCASE')
    .get(name)
  return row ?? null
}

export function createArtist(db: Database.Database, name: string, type: string | null = null): number {
  const info = db.prepare('INSERT INTO artists (name, type) VALUES (?, ?)').run(name, type)
  return Number(info.lastInsertRowid)
}

/* 查找已有艺术家，不存在则创建，返回 artist_id */
export function findOrCreateArtist(db: Database.Database, name: string): number {
  const existing = findArtistByName(db, name)
  if (existing) return existing.id
  return createArtist(db, name)
}

/*
 * 厂牌本质上也是一个 artist（type='Label'），复用同一张 artists 表而不是单独建厂牌表。
 * 已存在但 type 为空时顺手补上 'Label'，不覆盖已经标注为 Person/Group 的艺术家（避免误判）。
 */
export function findOrCreateLabelArtist(db: Database.Database, name: string): number {
  const existing = findArtistByName(db, name)
  if (existing) {
    if (existing.type == null) {
      db.prepare('UPDATE artists SET type = ? WHERE id = ?').run('Label', existing.id)
    }
    return existing.id
  }
  return createArtist(db, name, 'Label')
}

export function searchArtists(db: Database.Database, query: string): ArtistRow[] {
  return db
    .prepare<[string], ArtistRow>('SELECT * FROM artists WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 20')
    .all(`%${query}%`)
}

/*
 * Artist 星云第一层网格数据源：排除 type='Label' 的记录（厂牌本质上复用 artists 表存储，
 * 但不属于用户浏览意义上的"艺术家"，不应出现在这个星云里），附带关联曲目数量，按名称排序。
 */
export function listArtists(db: Database.Database): ArtistListItem[] {
  return db
    .prepare<[], ArtistListItem>(
      `SELECT ar.*, COUNT(DISTINCT sa.song_id) AS songCount
       FROM artists ar LEFT JOIN song_artists sa ON sa.artist_id = ar.id
       WHERE ar.type IS NOT 'Label'
       GROUP BY ar.id
       ORDER BY ar.name COLLATE NOCASE`
    )
    .all()
}

export function getArtistById(db: Database.Database, artistId: number): ArtistRow | null {
  const row = db.prepare<[number], ArtistRow>('SELECT * FROM artists WHERE id = ?').get(artistId)
  return row ?? null
}

/* 某艺术家（含 Featured/Composer 等角色）关联的全部曲目，按曲名排序，供 Artist 详情页展示 */
export function getArtistSongs(db: Database.Database, artistId: number): SongListItem[] {
  const rows = db
    .prepare<
      [number],
      { id: number; title: string; length: number | null; file_name: string }
    >(
      `SELECT DISTINCT s.id AS id, s.title AS title, s.length AS length, s.file_name AS file_name
       FROM song_artists sa JOIN songs s ON s.id = sa.song_id
       WHERE sa.artist_id = ? ORDER BY s.title COLLATE NOCASE`
    )
    .all(artistId)

  const artistStmt = db.prepare<[number], { name: string }>(
    `SELECT ar.name AS name
     FROM song_artists sa JOIN artists ar ON ar.id = sa.artist_id
     WHERE sa.song_id = ? ORDER BY sa.artist_order ASC`
  )

  return rows.map((row): SongListItem => {
    const artistRows = artistStmt.all(row.id)
    return { ...row, artistNames: artistRows.map((a: { name: string }) => a.name).join(', ') }
  })
}
