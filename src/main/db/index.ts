import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema'

let db: Database.Database | null = null

/*
 * 旧版 albums.label_id 是单值厂牌。复制成功后在同一事务内清空旧列，确保迁移幂等：
 * 用户以后清空全部厂牌时，重启应用不会把旧值再次迁回。
 */
function migrateLegacyAlbumLabels(database: Database.Database): void {
  const columns = database.pragma('table_info(albums)') as { name: string }[]
  database.transaction(() => {
    if (columns.some((column) => column.name === 'label_id')) {
      database.exec(`
        INSERT OR IGNORE INTO album_labels (album_id, label_id, label_order)
        SELECT id, label_id, 0 FROM albums WHERE label_id IS NOT NULL;
        UPDATE albums SET label_id = NULL WHERE label_id IS NOT NULL;
      `)
    }

    /*
     * 修复旧逻辑可能产生的“Person/Group/未分类记录被当作厂牌”关系。
     * 仅作为厂牌使用的记录直接改正 type，以保留 id、资料与图片关联；同时承担普通艺术家
     * 角色的记录才拆出同名 Label，避免改变既有歌曲、专辑艺术家和别名语义。
     */
    const invalidLabels = database
      .prepare<[], { id: number; name: string; type: string | null }>(
        `SELECT DISTINCT ar.id, ar.name, ar.type
         FROM album_labels abl JOIN artists ar ON ar.id = abl.label_id
         WHERE ar.type IS NULL OR ar.type <> 'Label'`
      )
      .all()
    for (const label of invalidLabels) {
      const usedAsArtist = database
        .prepare<
          [number, number, number, number],
          { present: number }
        >(
          `SELECT 1 AS present
           WHERE EXISTS (SELECT 1 FROM song_artists WHERE artist_id = ?)
              OR EXISTS (SELECT 1 FROM album_artists WHERE artist_id = ?)
              OR EXISTS (SELECT 1 FROM artist_aliases WHERE canonical_artist_id = ?)
              OR EXISTS (SELECT 1 FROM artist_aliases WHERE alias_artist_id = ?)`
        )
        .get(label.id, label.id, label.id, label.id)
      if (!usedAsArtist) {
        database.prepare("UPDATE artists SET name = trim(name), type = 'Label' WHERE id = ?").run(label.id)
        continue
      }

      const existing = database
        .prepare<[string], { id: number }>("SELECT id FROM artists WHERE trim(name) = trim(?) COLLATE NOCASE AND type = 'Label' ORDER BY id LIMIT 1")
        .get(label.name)
      const targetId = existing?.id ?? Number(database.prepare("INSERT INTO artists (name, type) VALUES (?, 'Label')").run(label.name.trim()).lastInsertRowid)
      database.prepare(
        `INSERT OR IGNORE INTO album_labels (album_id, label_id, label_order)
         SELECT album_id, ?, label_order FROM album_labels WHERE label_id = ?`
      ).run(targetId, label.id)
      database.prepare('DELETE FROM album_labels WHERE label_id = ?').run(label.id)
    }
  })()
}

/* 复合主键已经覆盖关联表的首列查询；清理早期重复创建的索引，避免旧库持续保留冗余副本。 */
function dropRedundantIndexes(database: Database.Database): void {
  database.exec(`
    DROP INDEX IF EXISTS idx_song_artists_song_id;
    DROP INDEX IF EXISTS idx_artist_aliases_canonical_artist_id;
    DROP INDEX IF EXISTS idx_album_songs_album_id;
    DROP INDEX IF EXISTS idx_album_artists_album_id;
    DROP INDEX IF EXISTS idx_album_labels_album_id;
    DROP INDEX IF EXISTS idx_song_tags_song_id;
  `)
}

/* 打开（或创建）位于给定路径的 SQLite 数据库，开启 WAL 与外键约束，并确保表结构存在 */
export function openDatabase(dbPath: string): Database.Database {
  const database = new Database(dbPath)
  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.exec(SCHEMA_SQL)
    dropRedundantIndexes(database)
    migrateLegacyAlbumLabels(database)
    /* 清理历史数据库中艺术家名称的前后空格；artist_id 不变，关联关系不受影响。 */
    database.exec('UPDATE artists SET name = trim(name) WHERE name <> trim(name)')
    db = database
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

/* 获取当前已打开的数据库实例，未初始化时抛错 */
export function getDatabase(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化，请先调用 openDatabase()')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}
