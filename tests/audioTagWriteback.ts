import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, link, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AudioTagWriter, AUDIO_TAG_WRITER_VERSION, canSkipAudioTags } from '../src/main/library/audioTagWriteback'
import { libraryPaths } from '../src/main/library/paths'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { hashAudioFile } from '../src/main/library/audioFileHash'
import { reloadAudioFile } from '../src/main/library/reload'
import { openDatabase, closeDatabase } from '../src/main/db'
import { parseAudioMetadata } from '../src/main/library/audioMetadata'
import sharp from 'sharp'
import type { AudioTagWriteProgress } from '../src/shared/types'

async function run(): Promise<void> {
  const [directory, worker, binary] = process.argv.slice(2)
  const paths = libraryPaths(directory, directory)
  await mkdir(paths.music, { recursive: true }); await mkdir(paths.database, { recursive: true })
  const db = openDatabase(paths.dbFile)
  db.exec(SCHEMA_SQL)
  const formats = ['flac', 'mp3', 'wav', 'ogg', 'm4a']
  const files: string[] = []
  for (const [index, format] of formats.entries()) {
    const fileName = `song-${index}.${format}`, file = join(paths.music, fileName)
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-ac', '2', '-metadata', 'album=old', '-metadata', 'album_artist=old', '-metadata', 'comment=163 key remove only mp3', ...(format === 'mp3' ? ['-id3v2_version', '3'] : format === 'ogg' ? ['-c:a', 'vorbis', '-strict', 'experimental'] : []), file])
    db.prepare('INSERT INTO songs (id, title, lyric, file_name) VALUES (?, ?, ?, ?)').run(index + 1, `歌曲 ${index}`, '[00:01.00]歌词\n[00:02.00]next', fileName)
    files.push(file)
  }
  const snapshots: AudioTagWriteProgress[] = []
  const writer = new AudioTagWriter(paths, () => db, worker, binary, progress => snapshots.push(progress))
  writer.start()
  assert(writer.running)
  await writer.completion
  assert.equal(writer.progress?.failed, 0, JSON.stringify(writer.progress))
  assert.equal(writer.progress?.written, 5)
  assert.equal(db.prepare('SELECT count(*) AS n FROM audio_tag_write_state WHERE status = ?').get('succeeded').n, 5)
  assert(snapshots.some(p => p.phase === 'committing'))
  const hashes = await Promise.all(files.map(file => hashAudioFile(file)))
  writer.start(); await writer.completion
  assert.equal(writer.progress?.skipped, 5)
  assert.equal(writer.progress?.written, 0)
  assert.deepEqual(await Promise.all(files.map(file => hashAudioFile(file))), hashes)
  console.log('PASS: production workers write five formats, persist verified hashes and skip unchanged originals')

  db.prepare('UPDATE songs SET title = ? WHERE id = 1').run('modified metadata')
  writer.start(); await writer.completion
  assert.equal(writer.progress?.written, 1); assert.equal(writer.progress?.skipped, 4)
  // 新增专辑 / 修改专辑资料同样会进入元数据指纹。
  db.exec("INSERT INTO albums (id, title, release_date) VALUES (1, 'Album', '2026-11'); INSERT INTO album_songs (album_id, song_id) VALUES (1, 1)")
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  db.exec("UPDATE albums SET title = 'Changed album' WHERE id = 1")
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  db.prepare("UPDATE audio_tag_write_state SET status = 'writing' WHERE song_id = 1").run()
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  db.prepare("UPDATE audio_tag_write_state SET writer_version = 'old' WHERE song_id = 1").run()
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  // 相同字节的应用内替换也要失效。
  const replacement = join(directory, 'replacement.flac')
  await copyFile(files[0], replacement)
  await reloadAudioFile(paths, 1, replacement, 'song-0.flac')
  assert.equal(db.prepare('SELECT status FROM audio_tag_write_state WHERE song_id = 1').get().status, 'pending')
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  console.log('PASS: song / album edits, interrupted states, writer upgrades and identical-byte audio replacement all trigger retries')

  // 外部文件变化即使未改数据库也必须重写。
  const external = join(directory, 'external.flac')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.1', external])
  await copyFile(external, files[0])
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  // 硬中断遗留的原文件硬链接与暂存文件只能在核对清单后清理。
  const stale = join(paths.music, '.venas-tag-write-1')
  await mkdir(stale)
  await writeFile(join(stale, 'manifest.json'), JSON.stringify({ version: 1, songId: 1, fileName: 'song-0.flac' }))
  await link(files[0], join(stale, 'original.bin'))
  await writeFile(join(stale, 'prepared.bin'), 'partial')
  db.prepare("UPDATE audio_tag_write_state SET status = 'writing' WHERE song_id = 1").run()
  writer.start([1]); await writer.completion
  assert.equal(writer.progress?.written, 1, JSON.stringify(writer.progress))
  assert.equal((await lstat(files[0])).nlink, 1)
  await mkdir(stale)
  await writeFile(join(stale, 'manifest.pending'), '{partial')
  db.prepare("UPDATE audio_tag_write_state SET status = 'writing' WHERE song_id = 1").run()
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  console.log('PASS: full-file hash detects external changes; a verified stale staging directory recovers safely')

  // 单首失败不会阻止其他歌曲，恢复文件以后失败项会重试。
  const hidden = join(directory, 'hidden.mp3')
  await rename(files[1], hidden)
  writer.start(); await writer.completion
  assert.equal(writer.progress?.failed, 1); assert.equal(writer.progress?.skipped, 4)
  assert.equal(db.prepare('SELECT status FROM audio_tag_write_state WHERE song_id = 2').get().status, 'failed')
  await rename(hidden, files[1]); writer.start(); await writer.completion
  assert.equal(writer.progress?.written, 1); assert.equal(writer.progress?.skipped, 4)
  const badBinaryWriter = new AudioTagWriter(paths, () => db, worker, join(directory, 'missing-writer'), () => {})
  const originalMp3 = await readFile(files[1])
  db.prepare("UPDATE audio_tag_write_state SET status = 'pending' WHERE song_id = 2").run()
  badBinaryWriter.start([2]); await badBinaryWriter.completion
  assert.equal(badBinaryWriter.progress?.failed, 1)
  assert.deepEqual(await readFile(files[1]), originalMp3)
  console.log('PASS: missing inputs / writer failures retain originals, record errors and retry successfully')

  let cancelWriter: AudioTagWriter
  cancelWriter = new AudioTagWriter(paths, () => db, worker, binary, p => {
    if (p.completed === 1 && p.status === 'running') cancelWriter.cancel()
  })
  cancelWriter.start(); const sameTask = cancelWriter.start()
  assert.equal(sameTask.taskId, cancelWriter.progress?.taskId)
  await cancelWriter.completion
  assert.equal(cancelWriter.progress?.status, 'cancelled'); assert.equal(cancelWriter.progress?.completed, 1)
  const state = { status: 'succeeded', metadata_hash: 'meta', file_hash: 'file', writer_version: AUDIO_TAG_WRITER_VERSION }
  for (const status of ['pending', 'writing', 'failed']) assert(!canSkipAudioTags({ ...state, status }, 'meta', 'file'))
  assert(canSkipAudioTags(state, 'meta', 'file'))
  console.log('PASS: duplicate start is idempotent, cancellation stops at a safe boundary; uncertain states never skip')

  // SQLite 无法记录成功：文件可完整提交，但不得虚报为已记录成功，下次仍重试。
  db.exec("UPDATE songs SET title = 'db failure sample' WHERE id = 1; CREATE TRIGGER fail_success BEFORE UPDATE ON audio_tag_write_state WHEN NEW.status = 'succeeded' BEGIN SELECT RAISE(ABORT, 'simulated sqlite failure'); END")
  writer.start([1]); await writer.completion
  assert.equal(writer.progress?.failed, 1)
  assert.notEqual(db.prepare('SELECT status FROM audio_tag_write_state WHERE song_id = 1').get().status, 'succeeded')
  db.exec('DROP TRIGGER fail_success')
  writer.start([1]); await writer.completion; assert.equal(writer.progress?.written, 1)
  db.prepare("UPDATE songs SET title = 'snapshot before writing' WHERE id = 1").run()
  let editedDuringWrite = false
  const snapshotWriter = new AudioTagWriter(paths, () => db, worker, binary, p => {
    if (p.phase === 'preparing' && !editedDuringWrite) {
      editedDuringWrite = true
      db.prepare("UPDATE songs SET title = 'edited while worker was active' WHERE id = 1").run()
    }
  })
  snapshotWriter.start([1]); await snapshotWriter.completion
  assert(editedDuringWrite); assert.equal(snapshotWriter.progress?.written, 1)
  snapshotWriter.start([1]); await snapshotWriter.completion
  assert.equal(snapshotWriter.progress?.written, 1, 'A concurrent edit was incorrectly fingerprinted as already written')
  snapshotWriter.start([1]); await snapshotWriter.completion; assert.equal(snapshotWriter.progress?.skipped, 1)
  db.prepare('DELETE FROM songs WHERE id = 1').run()
  assert.equal(db.prepare('SELECT count(*) AS n FROM audio_tag_write_state WHERE song_id = 1').get().n, 0)
  // TagLib 重分页后，大封面会跨过 music-metadata 默认的 12 页读取上限。
  // 通过值文件传入大图同时覆盖长参数不依赖 argv 长度的路径。
  const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#203040' } }).png({ compressionLevel: 0 }).toBuffer()
  const number = (value: number): Buffer => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes }
  const mime = Buffer.from('image/png')
  const picture = Buffer.concat([number(3), number(mime.length), mime, number(0), number(512), number(512), number(24), number(0), number(image.length), image]).toString('base64')
  const valueFile = join(directory, 'large-values.bin')
  const payload = Buffer.concat(['METADATA_BLOCK_PICTURE', picture].flatMap(text => {
    const bytes = Buffer.from(text), length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return [length, bytes]
  }))
  await writeFile(valueFile, payload)
  execFileSync(binary, ['ogg', files[3], '--values-file', valueFile])
  let metadata = await parseAudioMetadata(files[3])
  assert.deepEqual(Buffer.from(metadata.common.picture![0].data), image)
  writer.start([4]); await writer.completion
  assert.equal(writer.progress?.written, 1, JSON.stringify(writer.progress))
  metadata = await parseAudioMetadata(files[3])
  assert.deepEqual(Buffer.from(metadata.common.picture![0].data), image)
  assert.equal(metadata.common.title, '歌曲 3')
  console.log('PASS: large Ogg covers and tags are read completely after repagination; values-file input supports large Unicode fields')
  closeDatabase()
  console.log('PASS: failed success-record commits retry; concurrent edits retain the actual written snapshot; deletion cascades write-state cleanup')
}

void run().catch(error => { console.error(error); closeDatabase(); process.exitCode = 1 })
