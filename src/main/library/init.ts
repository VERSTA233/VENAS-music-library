import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { libraryPaths, type LibraryPaths } from './paths'
import { openDatabase } from '../db'

/* 确保音乐库根目录下的全部固定子目录存在（不存在则创建） */
function ensureDirectories(paths: LibraryPaths): void {
  const dirs = [
    paths.append,
    paths.music,
    paths.system,
    paths.tools,
    paths.cacheAudio,
    paths.cacheWaveforms,
    paths.assetsArtistPictures,
    paths.assetsSongPictures,
    paths.assetsAlbumPictures,
    paths.assetsUi,
    paths.logs
  ]
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true })
  }
}

/* 兼容旧版 .system 顶层数据库布局。应用尚未打开数据库时才执行，避免搬运运行中的 SQLite 文件。 */
function migrateLegacyDatabaseLayout(paths: LibraryPaths): void {
  mkdirSync(paths.database, { recursive: true })

  for (const suffix of ['', '-wal', '-shm']) {
    const legacyPath = join(paths.system, `music.db${suffix}`)
    const targetPath = join(paths.database, `music.db${suffix}`)
    if (existsSync(legacyPath) && !existsSync(targetPath)) renameSync(legacyPath, targetPath)
  }

  const legacyBackups = join(paths.system, 'backups')
  if (existsSync(legacyBackups) && !existsSync(paths.backups)) renameSync(legacyBackups, paths.backups)
  mkdirSync(paths.backups, { recursive: true })
}

/* 初始化音乐库：创建目录结构并打开（或新建）数据库 */
export function initLibrary(musicRoot: string, systemRoot: string): LibraryPaths {
  const paths = libraryPaths(musicRoot, systemRoot)
  ensureDirectories(paths)
  migrateLegacyDatabaseLayout(paths)
  openDatabase(paths.dbFile)
  return paths
}
