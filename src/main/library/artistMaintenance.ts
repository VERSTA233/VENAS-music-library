import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { LibraryPaths } from './paths'
import { deleteArtistRecord, mergeArtistRecords } from '../db/queries/artists'

/* 先暂存头像，数据库操作成功后删除；事务失败时恢复，避免艺术家记录与图片不同步。 */
function withStagedArtistPicture(paths: LibraryPaths, artistId: number, operation: () => void): void {
  const picturePath = join(paths.assetsArtistPictures, `${artistId}.jpg`)
  const stagedPath = join(paths.assetsArtistPictures, `.${artistId}.${Date.now()}.jpg.deleting`)
  const hasPicture = existsSync(picturePath)

  if (hasPicture) renameSync(picturePath, stagedPath)
  try {
    operation()
  } catch (error) {
    if (hasPicture && existsSync(stagedPath)) renameSync(stagedPath, picturePath)
    throw error
  }

  if (hasPicture && existsSync(stagedPath)) unlinkSync(stagedPath)
}

/* 删除艺术家不会删除音乐文件，只解除所有歌曲/专辑关联并移除该艺术家的头像。 */
export function deleteLibraryArtist(paths: LibraryPaths, db: Database.Database, artistId: number): void {
  withStagedArtistPicture(paths, artistId, () => deleteArtistRecord(db, artistId))
}

/* 合并后删除源艺术家及其头像；目标艺术家的头像不会被覆盖。 */
export function mergeLibraryArtist(
  paths: LibraryPaths,
  db: Database.Database,
  sourceArtistId: number,
  targetArtistId: number
): void {
  withStagedArtistPicture(paths, sourceArtistId, () => mergeArtistRecords(db, sourceArtistId, targetArtistId))
}
