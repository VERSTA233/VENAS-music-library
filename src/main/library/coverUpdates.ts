import type Database from 'better-sqlite3'
import type { CoverUpdate } from '../../shared/types'

/* 专辑内歌曲共享缓存，相关艺术家/厂牌的兜底头像也可能来自这张封面。 */
export function affectedCovers(db: Database.Database, target: { songId?: number; albumId?: number; artistId?: number }): CoverUpdate {
  if (target.artistId != null) return { songIds: [], albumIds: [], artistIds: [target.artistId] }
  const songId = target.songId ?? null
  const albumId = target.albumId ?? (songId == null ? null : db
    .prepare<[number], { album_id: number }>('SELECT album_id FROM album_songs WHERE song_id = ?')
    .get(songId)?.album_id ?? null)
  const songIds = albumId == null ? (songId == null ? [] : [songId]) : db
    .prepare<[number], { song_id: number }>('SELECT song_id FROM album_songs WHERE album_id = ?')
    .all(albumId).map(song => song.song_id)
  const artistIds = db.prepare<{ songId: number | null; albumId: number | null }, { id: number }>(`
    WITH affected_songs AS (
      SELECT id FROM songs WHERE id = @songId OR id IN (SELECT song_id FROM album_songs WHERE album_id = @albumId)
    ), direct_artists AS (
      SELECT artist_id AS id FROM song_artists WHERE song_id IN (SELECT id FROM affected_songs)
      UNION SELECT artist_id FROM album_artists WHERE album_id = @albumId
      UNION SELECT label_id FROM album_labels WHERE album_id = @albumId
    )
    SELECT id FROM direct_artists
    UNION SELECT canonical_artist_id FROM artist_aliases WHERE alias_artist_id IN (SELECT id FROM direct_artists)
  `).all({ songId, albumId }).map(artist => artist.id)
  return { songIds, albumIds: albumId == null ? [] : [albumId], artistIds }
}
