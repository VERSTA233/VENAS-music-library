import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema'

let db: Database.Database | null = null

/* 打开（或创建）位于给定路径的 SQLite 数据库，开启 WAL 与外键约束，并确保表结构存在 */
export function openDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
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
