import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
import type Database from 'better-sqlite3'
import type { LibraryPaths } from './paths'
import { deleteSong } from '../db/queries/songs'
import { deleteArtistRecord, isArtistMember } from '../db/queries/artists'

interface DeleteContext {
  fileName: string
  albumId: number | null
  artistIds: number[]
}

/* 删除歌曲同时清理其音频、封面，以及删除后无引用的专辑和艺术家资料。 */
export function deleteLibrarySong(paths: LibraryPaths, db: Database.Database, songId: number): void {
  const context = getDeleteContext(db, songId)
  if (!context) throw new Error('歌曲不存在')

  const originalPath = musicFilePath(paths, context.fileName)
  const stagedPath = join(paths.music, `.${songId}.${Date.now()}.${context.fileName}.deleting`)
  let audioStaged = false
  if (existsSync(originalPath)) {
    renameSync(originalPath, stagedPath)
    audioStaged = true
  }

  let deletedAlbumId: number | null = null
  try {
    db.transaction(() => {
      deleteSong(db, songId)
      if (context.albumId != null && countAlbumSongs(db, context.albumId) === 0) {
        db.prepare('DELETE FROM albums WHERE id = ?').run(context.albumId)
        deletedAlbumId = context.albumId
      }
      for (const artistId of context.artistIds) {
        if (canDeleteArtist(paths, db, artistId)) deleteArtistRecord(db, artistId)
      }
    })()
  } catch (error) {
    if (audioStaged && existsSync(stagedPath)) renameSync(stagedPath, originalPath)
    throw error
  }

  removeIfExists(join(paths.assetsSongPictures, `${songId}.jpg`))
  if (deletedAlbumId != null) removeIfExists(join(paths.assetsAlbumPictures, `${deletedAlbumId}.jpg`))
  for (const artistId of context.artistIds) {
    if (!artistExists(db, artistId)) removeIfExists(join(paths.assetsArtistPictures, `${artistId}.jpg`))
  }
  if (audioStaged) removeIfExists(stagedPath)
}

function getDeleteContext(db: Database.Database, songId: number): DeleteContext | null {
  const song = db.prepare<[number], { file_name: string }>('SELECT file_name FROM songs WHERE id = ?').get(songId)
  if (!song) return null
  const album = db.prepare<[number], { album_id: number }>('SELECT album_id FROM album_songs WHERE song_id = ?').get(songId)
  const artistIds = new Set<number>(db.prepare<[number], { artist_id: number }>('SELECT artist_id FROM song_artists WHERE song_id = ?').all(songId).map((row) => row.artist_id))
  if (album) {
    for (const row of db.prepare<[number], { artist_id: number }>('SELECT artist_id FROM album_artists WHERE album_id = ?').all(album.album_id)) artistIds.add(row.artist_id)
    for (const row of db.prepare<[number], { label_id: number }>('SELECT label_id FROM album_labels WHERE album_id = ?').all(album.album_id)) artistIds.add(row.label_id)
  }
  return { fileName: song.file_name, albumId: album?.album_id ?? null, artistIds: [...artistIds] }
}

function musicFilePath(paths: LibraryPaths, fileName: string): string {
  const path = join(paths.music, fileName)
  const rel = relative(paths.music, path)
  if (basename(fileName) !== fileName || isAbsolute(rel) || rel.startsWith('..')) throw new Error('歌曲文件名不合法，拒绝删除')
  return path
}

function countAlbumSongs(db: Database.Database, albumId: number): number {
  return db.prepare<[number], { count: number }>('SELECT COUNT(*) AS count FROM album_songs WHERE album_id = ?').get(albumId)?.count ?? 0
}

/* 艺术家仅在没有任何歌曲、专辑艺术家或厂牌引用，国家为空且头像不存在时自动删除。 */
function canDeleteArtist(paths: LibraryPaths, db: Database.Database, artistId: number): boolean {
  const artist = db.prepare<[number], { country: string | null }>('SELECT country FROM artists WHERE id = ?').get(artistId)
  if (!artist || artist.country?.trim()) return false
  if (existsSync(join(paths.assetsArtistPictures, `${artistId}.jpg`))) return false
  const usedBySong = db.prepare<[number], { present: number }>('SELECT 1 AS present FROM song_artists WHERE artist_id = ? LIMIT 1').get(artistId)
  const usedByAlbum = db.prepare<[number], { present: number }>('SELECT 1 AS present FROM album_artists WHERE artist_id = ? LIMIT 1').get(artistId)
  const usedAsLabel = db.prepare<[number], { present: number }>('SELECT 1 AS present FROM album_labels WHERE label_id = ? LIMIT 1').get(artistId)
  const usedInAlias = db
    .prepare<[number, number], { present: number }>(
      'SELECT 1 AS present WHERE EXISTS (SELECT 1 FROM artist_aliases WHERE canonical_artist_id = ?) OR EXISTS (SELECT 1 FROM artist_aliases WHERE alias_artist_id = ?)'
    )
    .get(artistId, artistId)
  return !usedBySong && !usedByAlbum && !usedAsLabel && !usedInAlias && !isArtistMember(db, artistId)
}

function artistExists(db: Database.Database, artistId: number): boolean {
  return !!db.prepare<[number], { id: number }>('SELECT id FROM artists WHERE id = ?').get(artistId)
}

function removeIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}
