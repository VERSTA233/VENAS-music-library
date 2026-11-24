import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { listSongs } from '../src/main/db/queries/songs'
import { getArtistSongs } from '../src/main/db/queries/artists'
import { getLabelAlbumGroups } from '../src/main/db/queries/labels'
import { getAlbumSongs } from '../src/main/db/queries/albums'
import { getTagSongs } from '../src/main/db/queries/tags'
import { touchLastHeard, updateSongInfo } from '../src/main/db/queries/songInfo'
import { sortSongs } from '../src/renderer/src/songSearch'
import { defaultListSortPreferences, defaultSortDirection, isListSortPreference, normalizeListSortPreferences } from '../src/shared/listSorting'
import type { SongListItem, SongListSort, SortDirection } from '../src/shared/types'

const ids = (songs: SongListItem[]): number[] => songs.map(song => song.id)

function fixture(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  db.exec(`
    INSERT INTO artists (id, name, type) VALUES (1, 'Artist', 'Person'), (2, 'Alias', 'Person'), (3, 'Label', 'Label');
    INSERT INTO artist_aliases (canonical_artist_id, alias_artist_id, alias_type) VALUES (1, 2, 'alias');
    INSERT INTO albums (id, title) VALUES (1, 'Album');
    INSERT INTO album_labels (album_id, label_id, label_order) VALUES (1, 3, 0);
    INSERT INTO tags (id, name, tag_type) VALUES (1, 'Tag', 'Mood');
    INSERT INTO songs (id, title, file_name) VALUES
      (1, 'Zulu', '1.flac'), (2, 'Echo', '2.mp3'), (3, 'Delta', '3.flac'),
      (4, 'Bravo', '4.flac'), (5, 'Alpha', '5.mp3'), (6, 'Foxtrot', '6.flac');
    INSERT INTO song_artists (song_id, artist_id, role, artist_order)
      SELECT id, CASE WHEN id = 6 THEN 2 ELSE 1 END, 'Primary', 0 FROM songs;
    INSERT INTO album_songs (song_id, album_id, disc_number, track_number) SELECT id, 1, 1, id FROM songs;
    INSERT INTO song_tags (song_id, tag_id, sort_order) SELECT id, 1, id FROM songs;
    INSERT INTO song_info (song_id, score, last_heard_date, add_time) VALUES
      (1, 0, '2025-01-01', '2025-01-01'), (2, 90, '2026-01-01', '2026-01-01'),
      (3, 90, '2026-01-01', '2026-01-01'), (4, null, null, null), (5, 50, '2026-06-01', '2026-06-01');
  `)
  return db
}

test('Music and Artist/Label share rating and listening-date sorting, with empty values last', () => {
  const db = fixture()
  try {
    const expected: [SongListSort, SortDirection, number[]][] = [
      ['score', 'desc', [3, 2, 5, 1, 6, 4]], ['score', 'asc', [1, 5, 2, 3, 4, 6]],
      ['lastHeard', 'desc', [5, 3, 2, 1, 6, 4]], ['lastHeard', 'asc', [1, 2, 3, 5, 4, 6]],
      ['addedAt', 'desc', [5, 3, 2, 1, 6, 4]], ['addedAt', 'asc', [1, 2, 3, 5, 4, 6]],
      ['library', 'desc', [6, 5, 4, 3, 2, 1]], ['library', 'asc', [1, 2, 3, 4, 5, 6]],
      ['title', 'asc', [5, 4, 3, 2, 6, 1]], ['title', 'desc', [1, 6, 2, 3, 4, 5]]
    ]
    const artistSongs = getArtistSongs(db, 1)
    const labelSongs = getLabelAlbumGroups(db, 3)[0].songs
    const originalIds = ids(artistSongs)
    for (const [sort, direction, order] of expected) {
      assert.deepEqual(ids(listSongs(db, sort, '', direction)), order, `Music ${sort} ${direction}`)
      assert.deepEqual(ids(sortSongs(artistSongs, sort, direction)), order, `Artist ${sort} ${direction}`)
      assert.deepEqual(ids(sortSongs(labelSongs, sort, direction)), order, `Label ${sort} ${direction}`)
    }
    assert.deepEqual(ids(artistSongs), originalIds, 'sorting must not mutate source data')
    assert.deepEqual(ids(sortSongs(artistSongs, 'lastHeard')), [5, 3, 2, 1, 6, 4])
    assert.deepEqual(ids(sortSongs(artistSongs, 'score')), [3, 2, 5, 1, 6, 4])
    assert.deepEqual(ids(getAlbumSongs(db, 1)), [1, 2, 3, 4, 5, 6], 'album track order must stay unchanged')
    assert.deepEqual(ids(getTagSongs(db, 1)), [1, 2, 3, 4, 5, 6], 'Tag manual order must stay unchanged')
    assert.deepEqual(ids(listSongs(db, 'score', 'Alias', 'desc')), [6], 'search must still apply before sorting')
  } finally { db.close() }
})

test('fresh queries reflect rating edits and newly recorded listening dates', () => {
  const db = fixture()
  try {
    updateSongInfo(db, 4, { firstHeardDate: null, score: 100, comment: null })
    assert.equal(listSongs(db, 'score')[0].id, 4)
    assert.equal(sortSongs(getArtistSongs(db, 1), 'score')[0].id, 4)
    touchLastHeard(db, 6)
    assert.equal(listSongs(db, 'lastHeard')[0].id, 6)
    assert.equal(sortSongs(getArtistSongs(db, 1), 'lastHeard')[0].id, 6)
  } finally { db.close() }
})

test('saved preferences preserve independent page choices and directions; old/invalid settings fall back per page', () => {
  const preferences = {
    music: { sort: 'score', direction: 'asc' }, artists: { sort: 'count', direction: 'desc' },
    albums: { sort: 'library', direction: 'asc' }, artistSongs: { sort: 'lastHeard', direction: 'desc' },
    labelSongs: { sort: 'addedAt', direction: 'asc' }
  }
  assert.deepEqual(normalizeListSortPreferences(JSON.parse(JSON.stringify(preferences))), preferences)
  assert.deepEqual(normalizeListSortPreferences(undefined), defaultListSortPreferences)
  assert.deepEqual(normalizeListSortPreferences({ music: preferences.music, artists: { sort: 'score', direction: 'desc' } }),
    { ...defaultListSortPreferences, music: preferences.music })
  assert.equal(isListSortPreference('music', { sort: 'score', direction: 'sideways' }), false)
  assert.equal(isListSortPreference('__proto__', preferences.music), false)
  assert.equal(isListSortPreference('music', null), false)
  assert.equal(defaultSortDirection('lastHeard'), 'desc')
  assert.equal(defaultSortDirection('score'), 'desc')
  assert.equal(defaultSortDirection('title'), 'asc')
})
