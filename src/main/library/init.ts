import { mkdirSync } from 'node:fs'
import { libraryPaths, type LibraryPaths } from './paths'
import { openDatabase } from '../db'

/* 确保音乐库根目录下的全部固定子目录存在（不存在则创建） */
function ensureDirectories(paths: LibraryPaths): void {
  const dirs = [
    paths.append,
    paths.music,
    paths.system,
    paths.backups,
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

/* 初始化音乐库：创建目录结构并打开（或新建）数据库 */
export function initLibrary(musicRoot: string, systemRoot: string): LibraryPaths {
  const paths = libraryPaths(musicRoot, systemRoot)
  ensureDirectories(paths)
  openDatabase(paths.dbFile)
  return paths
}
