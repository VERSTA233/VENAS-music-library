import type Database from 'better-sqlite3'
import type { TagRow, TagTypeItem, TagListItem, TagSongItem } from '../../../shared/types'
import { withArtistNames } from './songList'

export type { TagRow }

/* Tag 分类导航第一层：全部 tag_type 分组，附带该类型下的 Tag 数量，按类型名排序 */
export function listTagTypes(db: Database.Database): TagTypeItem[] {
  return db
    .prepare<[], TagTypeItem>(
      `SELECT COALESCE(tag_type, '未分类') AS tag_type, COUNT(*) AS tagCount
       FROM tags
       GROUP BY COALESCE(tag_type, '未分类')
       ORDER BY tag_type COLLATE NOCASE`
    )
    .all()
}

/* Tag 分类导航第二层：某个类型下的全部 Tag，附带每个 Tag 关联的曲目数 */
export function listTagsByType(db: Database.Database, tagType: string): TagListItem[] {
  return db
    .prepare<[string], TagListItem>(
      `SELECT t.*, COUNT(DISTINCT st.song_id) AS songCount
       FROM tags t LEFT JOIN song_tags st ON st.tag_id = t.id
       WHERE COALESCE(t.tag_type, '未分类') = ?
       GROUP BY t.id
       ORDER BY t.name COLLATE NOCASE`
    )
    .all(tagType)
}

export function getTagById(db: Database.Database, tagId: number): TagRow | null {
  const row = db.prepare<[number], TagRow>('SELECT * FROM tags WHERE id = ?').get(tagId)
  return row ?? null
}

/* 某 Tag 关联的全部曲目，按持久化 sort_order 排列，附带该曲目在这个 Tag 下的 comment。 */
export function getTagSongs(db: Database.Database, tagId: number): TagSongItem[] {
  const rows = db
    .prepare<
      [number],
      { id: number; title: string; length: number | null; file_name: string; add_time: string | null; comment: string | null; sort_order: number }
    >(
      `SELECT s.id AS id, s.title AS title, s.length AS length, s.file_name AS file_name, si.add_time AS add_time, st.comment AS comment, st.sort_order AS sort_order
       FROM song_tags st JOIN songs s ON s.id = st.song_id
       LEFT JOIN song_info si ON si.song_id = s.id
       WHERE st.tag_id = ? ORDER BY st.sort_order ASC, s.id ASC`
    )
    .all(tagId)

  return withArtistNames(db, rows)
}

export function removeSongFromTag(db: Database.Database, tagId: number, songId: number): void {
  db.prepare('DELETE FROM song_tags WHERE tag_id = ? AND song_id = ?').run(tagId, songId)
}

export function setSongTagComment(db: Database.Database, tagId: number, songId: number, comment: string | null): void {
  db.prepare('UPDATE song_tags SET comment = ? WHERE tag_id = ? AND song_id = ?').run(comment, tagId, songId)
}

/* 只接受当前 Tag 全量曲目的一个排列，避免前端局部筛选或过期数据破坏既有排序。 */
export function setTagSongOrder(db: Database.Database, tagId: number, songIds: number[]): void {
  const existingIds = db
    .prepare<[number], { song_id: number }>('SELECT song_id FROM song_tags WHERE tag_id = ?')
    .all(tagId)
    .map((row) => row.song_id)
  const expectedIds = new Set(existingIds)

  if (songIds.length !== existingIds.length || new Set(songIds).size !== songIds.length || songIds.some((songId) => !expectedIds.has(songId))) {
    throw new Error('Tag 曲目顺序已变化，请重新加载后再试')
  }

  const update = db.prepare<[number, number, number]>('UPDATE song_tags SET sort_order = ? WHERE tag_id = ? AND song_id = ?')
  db.transaction(() => {
    songIds.forEach((songId, index) => update.run(index, tagId, songId))
  })()
}

export function searchTags(db: Database.Database, query: string): TagRow[] {
  return db
    .prepare<[string], TagRow>(
      'SELECT id, name, tag_type, description FROM tags WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 20'
    )
    .all(`%${query}%`)
}

function requireTagName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('Tag 名称不能为空')
  return normalized
}

export function createTag(db: Database.Database, name: string, tagType: string): number {
  const info = db.prepare('INSERT INTO tags (name, tag_type) VALUES (?, ?)').run(requireTagName(name), tagType)
  return Number(info.lastInsertRowid)
}

/* Tag 类型允许为空；空值会在分类视图中归入“未分类”。 */
export function updateTagType(db: Database.Database, tagId: number, tagType: string | null): void {
  const result = db.prepare('UPDATE tags SET tag_type = ? WHERE id = ?').run(tagType, tagId)
  if (result.changes === 0) throw new Error('Tag 不存在')
}

/* Tag 改名保持原 id 和歌曲关联，并按不区分大小写的规则避免重名。 */
export function updateTag(db: Database.Database, tagId: number, name: string, tagType: string | null): void {
  const normalizedName = requireTagName(name)
  const conflict = db
    .prepare<[string, number], { id: number }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ? LIMIT 1')
    .get(normalizedName, tagId)
  if (conflict) throw new Error('已存在同名 Tag')

  const result = db.prepare('UPDATE tags SET name = ?, tag_type = ? WHERE id = ?').run(normalizedName, tagType, tagId)
  if (result.changes === 0) throw new Error('Tag 不存在')
}

/* 删除 Tag 后 song_tags 的关联由外键级联清除，不会删除歌曲本身。 */
export function deleteTag(db: Database.Database, tagId: number): void {
  const result = db.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
  if (result.changes === 0) throw new Error('Tag 不存在')
}
