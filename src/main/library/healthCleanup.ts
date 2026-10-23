import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { EmptyRecordCleanupResult } from '../../shared/types'
import { deleteArtistRecord } from '../db/queries/artists'
import { findAlbumsWithoutSongs, findArtistsWithoutSongs } from './health'
import type { LibraryPaths } from './paths'

/* 只删除用户本次看到的对象；在同一写事务内重新检查，跳过已获得歌曲关联的记录。 */
export function cleanEmptyLibraryRecords(
  paths: LibraryPaths,
  db: Database.Database,
  kind: 'album' | 'artist',
  requestedIds: number[]
): EmptyRecordCleanupResult {
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('无效的清理记录 ID')
  }
  const ids = [...new Set(requestedIds)]
  const stagedPictures: { original: string; staged: string }[] = []
  const result: EmptyRecordCleanupResult = { deletedIds: [], skippedIds: [], warnings: [] }

  try {
    db.transaction(() => {
      const eligibleIds = new Set(kind === 'album'
        ? findAlbumsWithoutSongs(db).map((album) => album.albumId)
        : findArtistsWithoutSongs(db).map((artist) => artist.artistId))
      for (const id of ids) {
        if (!eligibleIds.has(id)) {
          result.skippedIds.push(id)
          continue
        }
        const original = join(kind === 'album' ? paths.assetsAlbumPictures : paths.assetsArtistPictures, `${id}.jpg`)
        if (existsSync(original)) {
          const staged = `${original}.${randomUUID()}.deleting`
          renameSync(original, staged)
          stagedPictures.push({ original, staged })
        }
        if (kind === 'album') db.prepare('DELETE FROM albums WHERE id = ?').run(id)
        else deleteArtistRecord(db, id)
        result.deletedIds.push(id)
      }
    })()
  } catch (error) {
    const errors: unknown[] = [error]
    for (const { original, staged } of stagedPictures.reverse()) {
      try { renameSync(staged, original) } catch (restoreError) { errors.push(restoreError) }
    }
    if (errors.length > 1) throw new AggregateError(errors, '清理已回滚，但部分图片恢复失败，请检查系统目录')
    throw error
  }

  /* 数据库提交后清除暂存图片；失败时仍如实返回已删除记录，避免重复清理造成误解。 */
  for (const { staged } of stagedPictures) {
    try { unlinkSync(staged) } catch { result.warnings.push(`缓存图片未能移除：${staged}`) }
  }
  return result
}
