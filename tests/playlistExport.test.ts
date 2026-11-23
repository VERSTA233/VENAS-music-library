import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { mock, test } from 'node:test'
import Database from 'better-sqlite3'
import { PlaylistExporter } from '../src/main/library/playlistExport.ts'
import { libraryPaths } from '../src/main/library/paths.ts'
import { SCHEMA_SQL } from '../src/main/db/schema.ts'

async function fixture(run: (f: {
  db: Database.Database
  music: string
  output: string
  exporter: PlaylistExporter
  addSong: (id: number, name: string, present?: boolean) => Promise<void>
}) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), 'venas-playlist-test-'))
  const paths = libraryPaths(root, root)
  await fs.mkdir(paths.music)
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  try {
    await run({
      db, music: paths.music, output: join(paths.music, 'Playlist'), exporter: new PlaylistExporter(paths),
      addSong: async (id, name, present = true) => {
        db.prepare('INSERT INTO songs (id, title, file_name) VALUES (?, ?, ?)').run(id, `Song ${id}`, name)
        if (present) await fs.writeFile(join(paths.music, name), `audio ${id}`)
      }
    })
  } finally {
    db.close()
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('exports every Tag, persisted order, Unicode paths, empty files and distinct counts; replaces obsolete results', async () => {
  await fixture(async ({ db, music, output, exporter, addSong }) => {
    await addSong(1, '夜 #1 %.flac')
    await addSong(2, 'song two.mp3')
    await addSong(3, 'untagged.wav')
    db.exec(`INSERT INTO tags (id, name, tag_type) VALUES (1, 'Sorrow', 'Feeling'), (2, 'Mix', 'Playlist'), (3, 'Empty', NULL);
      INSERT INTO song_tags (song_id, tag_id, sort_order) VALUES (1, 1, 7), (2, 1, 1), (1, 2, 0);`)
    await fs.mkdir(join(output, 'Obsolete'), { recursive: true })
    await fs.writeFile(join(output, 'Obsolete', 'old.m3u'), 'old')
    const inspection = await exporter.inspect(db)
    assert.deepEqual(inspection.missingFiles, [])
    const outcome = await exporter.generate(inspection.token)
    assert.equal(outcome.status, 'complete')
    if (outcome.status !== 'complete') return
    assert.deepEqual(outcome.result, { directory: output, typeCount: 3, playlistCount: 3, songCount: 2, entryCount: 3, skippedFiles: [], warnings: [] })
    assert.equal(await fs.readFile(join(output, 'Feeling', 'Sorrow.m3u'), 'utf8'), '../../song two.mp3\n../../夜 #1 %.flac\n')
    assert.equal(await fs.readFile(join(output, 'Playlist', 'Mix.m3u'), 'utf8'), '../../夜 #1 %.flac\n')
    assert.equal((await fs.stat(join(output, '未分类', 'Empty.m3u'))).size, 0)
    assert.deepEqual((await fs.readdir(music)).sort(), ['Playlist', 'song two.mp3', 'untagged.wav', '夜 #1 %.flac'].sort())
    await assert.rejects(fs.stat(join(output, 'Obsolete')), { code: 'ENOENT' })
    assert.equal(await fs.readFile(join(music, '夜 #1 %.flac'), 'utf8'), 'audio 1')
  })
})

test('missing audio requires consent, cancellation retains old output, and continuation skips missing entries', async () => {
  await fixture(async ({ db, music, output, exporter, addSong }) => {
    await addSong(1, 'missing.flac', false)
    await addSong(2, 'untagged-missing.flac', false)
    db.exec(`INSERT INTO tags (id, name, tag_type) VALUES (1, 'Empty after skip', 'Feeling'); INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1);`)
    await fs.mkdir(output)
    await fs.writeFile(join(output, 'previous.m3u'), 'previous')
    const first = await exporter.inspect(db)
    assert.equal(first.missingFiles.length, 2)
    assert.equal((await exporter.generate(first.token)).status, 'confirmation-required')
    assert.equal(await fs.readFile(join(output, 'previous.m3u'), 'utf8'), 'previous')
    assert.deepEqual(await fs.readdir(music), ['Playlist'])
    exporter.cancel(first.token)
    await assert.rejects(exporter.generate(first.token), /失效/)
    const second = await exporter.inspect(db)
    const outcome = await exporter.generate(second.token, true)
    assert.equal(outcome.status, 'complete')
    if (outcome.status !== 'complete') return
    assert.equal(outcome.result.entryCount, 0)
    assert.equal(outcome.result.skippedFiles.length, 2)
    assert.equal(await fs.readFile(join(output, 'Feeling', 'Empty after skip.m3u'), 'utf8'), '')
  })
})

test('confirmation and generation use the original database snapshot', async () => {
  await fixture(async ({ db, output, exporter, addSong }) => {
    await addSong(1, 'one.mp3')
    await addSong(2, 'two.mp3')
    db.exec(`INSERT INTO tags (id, name, tag_type) VALUES (1, 'Before', 'Feeling'); INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1);`)
    const inspection = await exporter.inspect(db)
    db.exec(`UPDATE tags SET name = 'After'; DELETE FROM song_tags; INSERT INTO song_tags (song_id, tag_id) VALUES (2, 1);`)
    assert.equal((await exporter.generate(inspection.token)).status, 'complete')
    assert.equal(await fs.readFile(join(output, 'Feeling', 'Before.m3u'), 'utf8'), '../../one.mp3\n')
    await assert.rejects(fs.stat(join(output, 'Feeling', 'After.m3u')), { code: 'ENOENT' })
  })
})

test('newly missing files are reported again even after user approved another missing file', async () => {
  await fixture(async ({ db, music, exporter, addSong }) => {
    await addSong(1, 'one.mp3', false)
    await addSong(2, 'two.mp3')
    const inspection = await exporter.inspect(db)
    await fs.unlink(join(music, 'two.mp3'))
    const outcome = await exporter.generate(inspection.token, true)
    assert.equal(outcome.status, 'confirmation-required')
    if (outcome.status === 'confirmation-required') assert.deepEqual(outcome.inspection.missingFiles.map(f => f.songId), [1, 2])
    assert.deepEqual(await fs.readdir(music), [])
  })
})

test('failed final rename restores old output and cleans staging; busy generation rejects duplicate requests', async () => {
  await fixture(async ({ db, music, output, exporter }) => {
    await fs.mkdir(output)
    await fs.writeFile(join(output, 'previous.m3u'), 'previous')
    const inspection = await exporter.inspect(db)
    const originalRename = fs.rename
    mock.method(fs, 'rename', async (from, to) => {
      if (String(from).includes('.Playlist.generating-') && to === output) throw new Error('Simulated publish failure')
      return originalRename(from, to)
    })
    syncBuiltinESMExports()
    try {
      const pending = exporter.generate(inspection.token)
      await assert.rejects(exporter.generate(inspection.token), /正在生成/)
      await assert.rejects(pending, /Simulated publish failure/)
      assert.equal(await fs.readFile(join(output, 'previous.m3u'), 'utf8'), 'previous')
      assert.deepEqual(await fs.readdir(music), ['Playlist'])
    } finally {
      mock.restoreAll()
      syncBuiltinESMExports()
    }
  })
})

test('write/verification failure retains old output; no audio is moved or removed', async () => {
  await fixture(async ({ db, music, output, exporter, addSong }) => {
    await addSong(1, 'one.mp3')
    db.exec(`INSERT INTO tags (id, name, tag_type) VALUES (1, 'Test', 'Feeling'); INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1);`)
    await fs.mkdir(output)
    await fs.writeFile(join(output, 'previous.m3u'), 'previous')
    const inspection = await exporter.inspect(db)
    const originalReadFile = fs.readFile
    mock.method(fs, 'readFile', async (...args) => String(args[0]).includes('.Playlist.generating-') ? 'corrupt' : originalReadFile(...args))
    syncBuiltinESMExports()
    try {
      await assert.rejects(exporter.generate(inspection.token), /校验失败/)
      assert.equal(await fs.readFile(join(output, 'previous.m3u'), 'utf8'), 'previous')
      assert.deepEqual((await fs.readdir(music)).sort(), ['Playlist', 'one.mp3'])
    } finally {
      mock.restoreAll()
      syncBuiltinESMExports()
    }
  })
})

test('rejects a symlink output directory and never touches its target', async () => {
  await fixture(async ({ db, music, output, exporter }) => {
    const external = await fs.mkdtemp(join(tmpdir(), 'venas-playlist-external-'))
    try {
      await fs.writeFile(join(external, 'keep'), 'keep')
      await fs.symlink(external, output, process.platform === 'win32' ? 'junction' : 'dir')
      const inspection = await exporter.inspect(db)
      await assert.rejects(exporter.generate(inspection.token), /普通文件夹/)
      assert.equal(await fs.readFile(join(external, 'keep'), 'utf8'), 'keep')
      assert.deepEqual(await fs.readdir(music), ['Playlist'])
    } finally {
      await fs.unlink(output)
      await fs.rm(external, { recursive: true, force: true })
    }
  })
})

test('audio lost while writing staging triggers another confirmation and keeps previous output', async () => {
  await fixture(async ({ db, music, output, exporter, addSong }) => {
    await addSong(1, 'one.mp3')
    db.exec(`INSERT INTO tags (id, name, tag_type) VALUES (1, 'Test', 'Feeling'); INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1);`)
    await fs.mkdir(output)
    await fs.writeFile(join(output, 'previous.m3u'), 'previous')
    const inspection = await exporter.inspect(db)
    const originalWriteFile = fs.writeFile
    mock.method(fs, 'writeFile', async (...args) => {
      await originalWriteFile(...args)
      if (String(args[0]).includes('.Playlist.generating-')) await fs.unlink(join(music, 'one.mp3'))
    })
    syncBuiltinESMExports()
    try {
      const outcome = await exporter.generate(inspection.token)
      assert.equal(outcome.status, 'confirmation-required')
      if (outcome.status === 'confirmation-required') assert.equal(outcome.inspection.missingFiles[0].songId, 1)
      assert.equal(await fs.readFile(join(output, 'previous.m3u'), 'utf8'), 'previous')
      assert.deepEqual(await fs.readdir(music), ['Playlist'])
    } finally {
      mock.restoreAll()
      syncBuiltinESMExports()
    }
  })
})

test('if rollback also fails, previous results remain in a reported backup directory', async () => {
  await fixture(async ({ db, music, output, exporter }) => {
    await fs.mkdir(output)
    await fs.writeFile(join(output, 'previous.m3u'), 'previous')
    const inspection = await exporter.inspect(db)
    const originalRename = fs.rename
    mock.method(fs, 'rename', async (from, to) => {
      if (to === output) throw new Error('Simulated publish and rollback failure')
      return originalRename(from, to)
    })
    syncBuiltinESMExports()
    try {
      await assert.rejects(exporter.generate(inspection.token), /旧结果保留在/)
      const remaining = await fs.readdir(music)
      assert.equal(remaining.length, 1)
      assert.match(remaining[0], /^\.Playlist.backup-/)
      assert.equal(await fs.readFile(join(music, remaining[0], 'previous.m3u'), 'utf8'), 'previous')
    } finally {
      mock.restoreAll()
      syncBuiltinESMExports()
    }
  })
})

test('failure to remove the old backup reports a warning without losing new or old results', async () => {
  await fixture(async ({ db, music, output, exporter }) => {
    await fs.mkdir(output)
    await fs.writeFile(join(output, 'previous.m3u'), 'previous')
    const inspection = await exporter.inspect(db)
    const originalRm = fs.rm
    mock.method(fs, 'rm', async (...args) => {
      if (String(args[0]).includes('.Playlist.backup-')) throw new Error('Simulated backup cleanup failure')
      return originalRm(...args)
    })
    syncBuiltinESMExports()
    try {
      const outcome = await exporter.generate(inspection.token)
      assert.equal(outcome.status, 'complete')
      if (outcome.status !== 'complete') return
      assert.equal(outcome.result.warnings.length, 1)
      assert.deepEqual(await fs.readdir(output), [])
      const backup = (await fs.readdir(music)).find(name => name.startsWith('.Playlist.backup-'))
      assert.ok(backup)
      assert.equal(await fs.readFile(join(music, backup, 'previous.m3u'), 'utf8'), 'previous')
    } finally {
      mock.restoreAll()
      syncBuiltinESMExports()
    }
  })
})
