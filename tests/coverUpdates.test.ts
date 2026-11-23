import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { affectedCovers } from '../src/main/library/coverUpdates'

test('cover updates include shared album songs and related avatars, excluding unrelated resources', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON'); db.exec(SCHEMA_SQL)
    db.exec(`INSERT INTO artists (id, name, type) VALUES
      (1, 'Artist', 'Person'), (2, 'Album artist', 'Person'), (3, 'Label', 'Label'),
      (4, 'Alias', 'Person'), (5, 'Canonical', 'Person'), (6, 'Unrelated', 'Person');
      INSERT INTO artist_aliases VALUES (5, 4, 'alias');
      INSERT INTO albums (id, title) VALUES (7, 'Shared'), (8, 'Unrelated');
      INSERT INTO songs (id, title, file_name) VALUES (10, 'First', '1.flac'), (11, 'Second', '2.flac'), (12, 'Unrelated', '3.flac'), (13, 'Standalone', '4.flac');
      INSERT INTO album_songs (album_id, song_id) VALUES (7, 10), (7, 11), (8, 12);
      INSERT INTO song_artists (song_id, artist_id, role) VALUES (10, 1, 'Primary'), (11, 4, 'Primary'), (12, 6, 'Primary'), (13, 1, 'Primary');
      INSERT INTO album_artists (album_id, artist_id) VALUES (7, 2);
      INSERT INTO album_labels (album_id, label_id) VALUES (7, 3);`)
    const expected = { songIds: [10, 11], albumIds: [7], artistIds: [1, 2, 3, 4, 5] }
    assert.deepEqual(affectedCovers(db, { songId: 10 }), expected)
    assert.deepEqual(affectedCovers(db, { albumId: 7 }), expected)
    assert.deepEqual(affectedCovers(db, { songId: 13 }), { songIds: [13], albumIds: [], artistIds: [1] })
    assert.deepEqual(affectedCovers(db, { artistId: 1 }), { songIds: [], albumIds: [], artistIds: [1] })
    assert.deepEqual(affectedCovers(db, {}), { songIds: [], albumIds: [], artistIds: [] })
  } finally { db.close() }
})
