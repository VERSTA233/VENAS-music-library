import type Database from 'better-sqlite3'
import type { TagRow } from '../../../shared/types'

export type { TagRow }

export function searchTags(db: Database.Database, query: string): TagRow[] {
  return db
    .prepare<[string], TagRow>(
      'SELECT id, name, tag_type, description FROM tags WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 20'
    )
    .all(`%${query}%`)
}

export function listTagsByType(db: Database.Database, tagType: string): TagRow[] {
  return db
    .prepare<[string], TagRow>('SELECT id, name, tag_type, description FROM tags WHERE tag_type = ? ORDER BY name')
    .all(tagType)
}

export function createTag(db: Database.Database, name: string, tagType: string): number {
  const info = db.prepare('INSERT INTO tags (name, tag_type) VALUES (?, ?)').run(name, tagType)
  return Number(info.lastInsertRowid)
}
