import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { createIngestArtistSelectionResolver } from '../src/main/library/artistSelection'

function fixture(run: (db: Database.Database) => void): void {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    run(db)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  } finally {
    db.close()
  }
}

test('ingest reuses the song artist after both names were edited, with the song type', () => fixture((db) => {
  const { resolveSong, resolveAlbum } = createIngestArtistSelectionResolver(db)
  const songId = resolveSong({ name: '  Shared Name  ', type: 'Group', createNew: true })
  const albumId = resolveAlbum({ name: 'shared name', type: 'Person', createNew: true })
  assert.equal(albumId, songId)
  assert.deepEqual(db.prepare('SELECT name, type FROM artists').all(), [{ name: 'Shared Name', type: 'Group' }])
}))

test('ingest prefers the song artist when album artist explicitly requests a separate same-name record', () => fixture((db) => {
  db.exec("INSERT INTO artists (id, name, type) VALUES (1, 'Existing', 'Person')")
  const { resolveSong, resolveAlbum } = createIngestArtistSelectionResolver(db)
  const songId = resolveSong({ name: 'Existing', type: 'Group' })
  const albumId = resolveAlbum({ name: 'Existing', type: 'Group', createNew: true })
  assert.equal(songId, 1)
  assert.equal(albumId, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artists').get().count, 1)
}))

test('ingest also prefers an explicitly new song artist over an existing same-name album selection', () => fixture((db) => {
  db.exec("INSERT INTO artists (id, name, type) VALUES (1, 'Duplicate', 'Person')")
  const { resolveSong, resolveAlbum } = createIngestArtistSelectionResolver(db)
  const songId = resolveSong({ name: 'Duplicate', type: 'Group', createNew: true })
  const albumId = resolveAlbum({ name: 'Duplicate', type: null, artistId: 1 })
  assert.equal(albumId, songId)
  assert.notEqual(songId, 1)
  assert.equal(db.prepare('SELECT type FROM artists WHERE id = ?').get(songId).type, 'Group')
}))

test('ingest uses the song selection when two existing artists share the same name', () => fixture((db) => {
  db.exec("INSERT INTO artists (id, name, type) VALUES (1, 'Same', 'Person'), (2, 'Same', 'Group')")
  const { resolveSong, resolveAlbum } = createIngestArtistSelectionResolver(db)
  assert.equal(resolveSong({ name: 'Same', type: null, artistId: 2 }), 2)
  assert.equal(resolveAlbum({ name: 'Same', type: null, artistId: 1 }), 2)
}))

test('different song and album artist names remain independent', () => fixture((db) => {
  const { resolveSong, resolveAlbum } = createIngestArtistSelectionResolver(db)
  const songId = resolveSong({ name: 'Song Artist', type: 'Person', createNew: true })
  const albumId = resolveAlbum({ name: 'Album Artist', type: 'Group', createNew: true })
  assert.notEqual(albumId, songId)
  assert.deepEqual(db.prepare('SELECT name, type FROM artists ORDER BY id').all(), [
    { name: 'Song Artist', type: 'Person' },
    { name: 'Album Artist', type: 'Group' }
  ])
}))

