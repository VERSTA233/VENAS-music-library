import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { LibraryPaths } from './paths'
import { deleteArtistRecord, isArtistMember } from '../db/queries/artists'

export interface OrphanCandidates {
  albumIds: Set<number>
  artistIds: Set<number>
}

export interface OrphanCleanupResult {
  albumIds: number[]
  artistIds: number[]
}

export function createOrphanCandidates(): OrphanCandidates {
  return { albumIds: new Set(), artistIds: new Set() }
}

/* 在覆盖关系前记录旧对象；关系写入完成后只检查这些可能刚失去引用的对象。 */
export function addAlbumOrphanCandidates(
  db: Database.Database,
  candidates: OrphanCandidates,
  albumId: number
): void {
  candidates.albumIds.add(albumId)
  for (const row of db
    .prepare<[number], { artist_id: number }>('SELECT artist_id FROM album_artists WHERE album_id = ?')
    .all(albumId)) {
    candidates.artistIds.add(row.artist_id)
  }
  for (const row of db
    .prepare<[number], { label_id: number }>('SELECT label_id FROM album_labels WHERE album_id = ?')
    .all(albumId)) {
    candidates.artistIds.add(row.label_id)
  }
}

export function addSongOrphanCandidates(
  db: Database.Database,
  candidates: OrphanCandidates,
  songId: number
): void {
  for (const row of db
    .prepare<[number], { artist_id: number }>('SELECT artist_id FROM song_artists WHERE song_id = ?')
    .all(songId)) {
    candidates.artistIds.add(row.artist_id)
  }
  const album = db
    .prepare<[number], { album_id: number }>('SELECT album_id FROM album_songs WHERE song_id = ?')
    .get(songId)
  if (album) addAlbumOrphanCandidates(db, candidates, album.album_id)
}

/*
 * 必须在调用方的写入事务内执行：先删无曲目的专辑，再判断艺术家/厂牌是否已完全失去音乐关联。
 * 别名和团队成员仍属于有效结构关系，自动清理不会破坏它们。
 */
export function cleanupOrphanCandidates(
  db: Database.Database,
  candidates: OrphanCandidates
): OrphanCleanupResult {
  const deletedAlbumIds: number[] = []
  const deletedArtistIds: number[] = []

  for (const albumId of candidates.albumIds) {
    const exists = db.prepare<[number], { present: number }>('SELECT 1 AS present FROM albums WHERE id = ?').get(albumId)
    if (!exists) continue
    const hasSongs = db
      .prepare<[number], { present: number }>('SELECT 1 AS present FROM album_songs WHERE album_id = ? LIMIT 1')
      .get(albumId)
    if (hasSongs) continue

    /* 删除专辑会级联移除专辑艺术家和厂牌关系，先把它们加入后续清理候选。 */
    addAlbumOrphanCandidates(db, candidates, albumId)
    db.prepare('DELETE FROM albums WHERE id = ?').run(albumId)
    deletedAlbumIds.push(albumId)
  }

  for (const artistId of candidates.artistIds) {
    if (!canDeleteArtist(db, artistId)) continue
    deleteArtistRecord(db, artistId)
    deletedArtistIds.push(artistId)
  }

  return { albumIds: deletedAlbumIds, artistIds: deletedArtistIds }
}

function canDeleteArtist(db: Database.Database, artistId: number): boolean {
  const artist = db.prepare<[number], { id: number }>('SELECT id FROM artists WHERE id = ?').get(artistId)
  if (!artist) return false
  const references = db
    .prepare<[number, number, number, number, number], { present: number }>(
      `SELECT 1 AS present
       WHERE EXISTS (SELECT 1 FROM song_artists WHERE artist_id = ?)
          OR EXISTS (SELECT 1 FROM album_artists WHERE artist_id = ?)
          OR EXISTS (SELECT 1 FROM album_labels WHERE label_id = ?)
          OR EXISTS (SELECT 1 FROM artist_aliases WHERE canonical_artist_id = ?)
          OR EXISTS (SELECT 1 FROM artist_aliases WHERE alias_artist_id = ?)`
    )
    .get(artistId, artistId, artistId, artistId, artistId)
  return !references && !isArtistMember(db, artistId)
}

/* 图片是数据库记录的派生缓存，只在数据库事务成功提交后清除。 */
export function removeOrphanPictures(paths: LibraryPaths, result: OrphanCleanupResult): void {
  for (const albumId of result.albumIds) removeIfExists(join(paths.assetsAlbumPictures, `${albumId}.jpg`))
  for (const artistId of result.artistIds) removeIfExists(join(paths.assetsArtistPictures, `${artistId}.jpg`))
}

function removeIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}
