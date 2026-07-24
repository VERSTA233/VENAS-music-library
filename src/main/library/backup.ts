import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { LibraryPaths } from './paths'

const MAX_BACKUPS = 3
const BACKUP_PREFIX = 'music_bak_'
const BACKUP_SUFFIX = '.db'

function todayStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/* 若今天尚未备份过数据库，则复制一份；随后只保留最近 3 份备份，多余的按日期删除 */
export function runDailyBackup(paths: LibraryPaths): void {
  const todayFile = join(paths.backups, `${BACKUP_PREFIX}${todayStamp()}${BACKUP_SUFFIX}`)
  if (!existsSync(todayFile) && existsSync(paths.dbFile)) {
    copyFileSync(paths.dbFile, todayFile)
  }
  pruneOldBackups(paths)
}

function pruneOldBackups(paths: LibraryPaths): void {
  const files = readdirSync(paths.backups)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX))
    .map((f) => ({ name: f, mtime: statSync(join(paths.backups, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime) // 新到旧

  for (const stale of files.slice(MAX_BACKUPS)) {
    unlinkSync(join(paths.backups, stale.name))
  }
}
