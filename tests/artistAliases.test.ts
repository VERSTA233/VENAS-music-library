import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { getArtistAliasOf, getArtistSongs, previewArtistAlias, setArtistAlias } from '../src/main/db/queries/artists'

function fixture(run: (db: Database.Database) => void): void {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    db.exec(`INSERT INTO artists (id, name, type) VALUES
      (1, 'Main A', 'Person'), (2, 'Alias B', 'Person'), (3, 'Main C', 'Group'), (4, 'Label', 'Label');
      INSERT INTO songs (id, title, file_name) VALUES (1, 'Song B', 'b.flac');
      INSERT INTO song_artists (song_id, artist_id) VALUES (1, 2);`)
    run(db)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  } finally { db.close() }
}

test('alias editing changes type and canonical artist without duplicate relations or lost songs', () => fixture((db) => {
  setArtistAlias(db, 2, 1, 'alias')
  setArtistAlias(db, 2, 1, 'former name')
  assert.deepEqual(getArtistAliasOf(db, 2), { id: 1, name: 'Main A', aliasType: 'former name' })
  assert.equal(getArtistSongs(db, 1).length, 1)
  setArtistAlias(db, 2, 3, 'alias')
  assert.deepEqual(getArtistAliasOf(db, 2), { id: 3, name: 'Main C', aliasType: 'alias' })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artist_aliases').get().count, 1)
  assert.equal(getArtistSongs(db, 1).length, 0)
  assert.equal(getArtistSongs(db, 3).length, 1)
  assert.deepEqual(db.prepare('SELECT song_id, artist_id FROM song_artists').all(), [{ song_id: 1, artist_id: 2 }])
}))

test('clearing an alias removes only its relationship, keeps artist metadata and direct song credits', () => fixture((db) => {
  db.exec("UPDATE artists SET country = 'Japan' WHERE id = 2")
  const before = db.prepare('SELECT * FROM artists WHERE id = 2').get()
  setArtistAlias(db, 2, 1, 'alias')
  setArtistAlias(db, 2, null, 'alias')
  setArtistAlias(db, 2, null, 'alias')
  assert.equal(getArtistAliasOf(db, 2), null)
  assert.deepEqual(db.prepare('SELECT * FROM artists WHERE id = 2').get(), before)
  assert.equal(getArtistSongs(db, 1).length, 0)
  assert.equal(getArtistSongs(db, 2).length, 1)
  setArtistAlias(db, 2, 3, 'former name')
  assert.equal(getArtistAliasOf(db, 2)?.id, 3)
}))

test('invalid changes preserve the previous relationship and prevent cycles', () => fixture((db) => {
  setArtistAlias(db, 2, 1, 'alias')
  for (const target of [2, 4, 999]) {
    assert.throws(() => setArtistAlias(db, 2, target, 'former name'))
    assert.equal(getArtistAliasOf(db, 2)?.id, 1)
  }
  assert.throws(() => setArtistAlias(db, 1, 2, 'alias'), /循环/)
  assert.equal(getArtistAliasOf(db, 1), null)
  setArtistAlias(db, 1, null, 'alias')
  assert.equal(getArtistAliasOf(db, 2)?.id, 1)
}))

test('moving a main artist flattens its aliases and retains each relationship type and original song credits', () => fixture((db) => {
  // A (1) is a former name of B (2), then B becomes an alias of C (3).
  db.exec(`INSERT INTO songs (id, title, file_name) VALUES (2, 'Song A', 'a.flac');
    INSERT INTO song_artists (song_id, artist_id) VALUES (2, 1);`)
  setArtistAlias(db, 1, 2, 'former name')
  setArtistAlias(db, 2, 3, 'alias')
  assert.deepEqual(getArtistAliasOf(db, 1), { id: 3, name: 'Main C', aliasType: 'former name' })
  assert.deepEqual(getArtistAliasOf(db, 2), { id: 3, name: 'Main C', aliasType: 'alias' })
  assert.equal(getArtistAliasOf(db, 3), null)
  assert.deepEqual(getArtistSongs(db, 3).map((song) => song.id).sort(), [1, 2])
  assert.equal(getArtistSongs(db, 2).length, 1)
  assert.deepEqual(db.prepare('SELECT song_id, artist_id FROM song_artists ORDER BY song_id').all(), [
    { song_id: 1, artist_id: 2 }, { song_id: 2, artist_id: 1 }
  ])
}))

test('choosing an existing alias resolves its main artist regardless of the order relationships were created', () => fixture((db) => {
  setArtistAlias(db, 2, 3, 'alias')
  setArtistAlias(db, 1, 2, 'former name')
  assert.equal(getArtistAliasOf(db, 1)?.id, 3)
  assert.equal(getArtistAliasOf(db, 1)?.aliasType, 'former name')
  assert.equal(getArtistAliasOf(db, 2)?.aliasType, 'alias')
  setArtistAlias(db, 1, 2, 'alias')
  assert.equal(getArtistAliasOf(db, 1)?.aliasType, 'alias')
  // Changing or clearing A never changes sibling B's type or relationship.
  setArtistAlias(db, 1, null, 'alias')
  assert.equal(getArtistAliasOf(db, 1), null)
  assert.equal(getArtistAliasOf(db, 2)?.id, 3)
}))

test('moves multiple aliases atomically and restores old relationships if the final write fails', () => fixture((db) => {
  db.exec("INSERT INTO artists (id, name, type) VALUES (5, 'Other alias', 'Person')")
  setArtistAlias(db, 1, 2, 'former name')
  setArtistAlias(db, 5, 2, 'alias')
  db.exec(`CREATE TRIGGER fail_alias_insert BEFORE INSERT ON artist_aliases
    WHEN NEW.alias_artist_id = 2 BEGIN SELECT RAISE(ABORT, 'test write failed'); END`)
  assert.throws(() => setArtistAlias(db, 2, 3, 'alias'), /test write failed/)
  assert.equal(getArtistAliasOf(db, 1)?.id, 2)
  assert.equal(getArtistAliasOf(db, 5)?.id, 2)
  assert.equal(getArtistAliasOf(db, 2), null)
  db.exec('DROP TRIGGER fail_alias_insert')
  setArtistAlias(db, 2, 3, 'alias')
  assert.equal(getArtistAliasOf(db, 1)?.aliasType, 'former name')
  assert.equal(getArtistAliasOf(db, 5)?.aliasType, 'alias')
  assert.equal(getArtistAliasOf(db, 5)?.id, 3)
}))

test('handles historical nested targets and detects malformed cyclic targets without looping', () => fixture((db) => {
  db.exec(`INSERT INTO artists (id, name, type) VALUES (5, 'Deep alias', 'Person');
    INSERT INTO artist_aliases (canonical_artist_id, alias_artist_id, alias_type)
    VALUES (3, 2, 'alias'), (2, 5, 'former name');`)
  setArtistAlias(db, 1, 5, 'former name')
  assert.equal(getArtistAliasOf(db, 1)?.id, 3)
  db.exec('UPDATE artist_aliases SET canonical_artist_id = 5 WHERE alias_artist_id = 2')
  assert.throws(() => setArtistAlias(db, 1, 2, 'alias'), /循环/)
  assert.equal(getArtistAliasOf(db, 1)?.id, 3)
}))

test('moving a main artist also flattens historical deeper descendants while preserving nullable legacy types', () => fixture((db) => {
  db.exec(`INSERT INTO artists (id, name, type) VALUES (5, 'Deep alias', 'Person');
    INSERT INTO artist_aliases (canonical_artist_id, alias_artist_id, alias_type)
    VALUES (2, 1, 'former name'), (1, 5, NULL);`)
  setArtistAlias(db, 2, 3, 'alias')
  assert.deepEqual(getArtistAliasOf(db, 5), { id: 3, name: 'Main C', aliasType: null })
  assert.equal(getArtistAliasOf(db, 1)?.id, 3)
  assert.equal(getArtistAliasOf(db, 1)?.aliasType, 'former name')
  assert.equal(getArtistAliasOf(db, 2)?.id, 3)
}))

test('preview names the final main artist and inherited types without writing any relationships', () => fixture((db) => {
  setArtistAlias(db, 1, 2, 'former name')
  const before = db.prepare('SELECT * FROM artist_aliases').all()
  const plan = previewArtistAlias(db, 2, 3, 'alias')
  assert.equal(plan.needsConfirmation, true)
  assert.deepEqual(plan.canonicalArtist, { id: 3, name: 'Main C' })
  assert.deepEqual(plan.aliases, [
    { id: 2, name: 'Alias B', aliasType: 'alias' },
    { id: 1, name: 'Main A', aliasType: 'former name' }
  ])
  assert.deepEqual(db.prepare('SELECT * FROM artist_aliases').all(), before)
  setArtistAlias(db, 2, 3, 'alias')
  for (const entry of plan.aliases) {
    assert.deepEqual(getArtistAliasOf(db, entry.id), { ...plan.canonicalArtist, aliasType: entry.aliasType })
  }
}))

test('preview warns when choosing another alias, but ordinary direct aliases need no extra confirmation', () => fixture((db) => {
  assert.equal(previewArtistAlias(db, 1, 3, 'former name').needsConfirmation, false)
  setArtistAlias(db, 2, 3, 'alias')
  const plan = previewArtistAlias(db, 1, 2, 'former name')
  assert.equal(plan.needsConfirmation, true)
  assert.deepEqual(plan.selectedArtist, { id: 2, name: 'Alias B' })
  assert.deepEqual(plan.canonicalArtist, { id: 3, name: 'Main C' })
  assert.deepEqual(plan.aliases, [{ id: 1, name: 'Main A', aliasType: 'former name' }])
  assert.equal(getArtistAliasOf(db, 1), null)
  assert.throws(() => previewArtistAlias(db, 3, 2, 'alias'), /循环/)
}))
