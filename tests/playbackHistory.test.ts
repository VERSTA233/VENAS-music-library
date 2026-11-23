import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'
import { getLastHeardDates, touchLastHeard, updateSongInfo } from '../src/main/db/queries/songInfo.ts'

test('playback history bulk query and local date upsert preserve song metadata', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    db.exec(`INSERT INTO songs (id, title, file_name) VALUES (1, 'A', 'a.mp3'), (2, 'B', 'b.mp3');
      INSERT INTO song_info (song_id, score, comment) VALUES (1, 4, 'keep');`)
    assert.deepEqual(getLastHeardDates(db), [])
    const today = db.prepare("SELECT DATE('now', 'localtime') AS date").get().date
    assert.equal(touchLastHeard(db, 1), today)
    assert.equal(touchLastHeard(db, 1), today)
    assert.equal(touchLastHeard(db, 2), today)
    assert.deepEqual(getLastHeardDates(db), [{ songId: 1, date: today }, { songId: 2, date: today }])
    assert.deepEqual(db.prepare('SELECT score, comment FROM song_info WHERE song_id = 1').get(), { score: 4, comment: 'keep' })
    assert.throws(() => touchLastHeard(db, 999), /FOREIGN KEY/)
  } finally { db.close() }
})

test('editing user metadata clears optional fields without overwriting import and playback dates', () => {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    db.exec(`INSERT INTO songs (id, title, file_name) VALUES (1, 'A', 'a.mp3'), (2, 'B', 'b.mp3');
      INSERT INTO song_info (song_id, add_time, last_heard_date, first_heard_date, score, comment)
      VALUES (1, '2026-01-02', '2026-11-01', '2025-03', 4, 'old');`)
    updateSongInfo(db, 1, { firstHeardDate: null, score: null, comment: null })
    assert.deepEqual(db.prepare('SELECT * FROM song_info WHERE song_id = 1').get(), {
      song_id: 1, add_time: '2026-01-02', last_heard_date: '2026-11-01', first_heard_date: null, score: null, comment: null
    })
    updateSongInfo(db, 2, { firstHeardDate: '2026-10', score: 5, comment: 'new' })
    assert.deepEqual(db.prepare('SELECT * FROM song_info WHERE song_id = 2').get(), {
      song_id: 2, add_time: null, last_heard_date: null, first_heard_date: '2026-10', score: 5, comment: 'new'
    })
    assert.throws(() => updateSongInfo(db, 999, { firstHeardDate: null, score: null, comment: null }), /FOREIGN KEY/)
  } finally { db.close() }
})
