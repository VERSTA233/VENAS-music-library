import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rename, writeFile, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../src/main/db/schema'
import { AudioIntegrityScanner, clearAudioIntegrityScanState } from '../src/main/library/audioIntegrity'
import { hasM4aCoverWithValidAudioTiming } from '../src/main/library/m4aCoverTiming'
import { libraryPaths } from '../src/main/library/paths'
import type { AudioIntegrityProgressUpdate } from '../src/shared/types'

// FFmpeg 的 FLAC 编码器只生成 16/24/32 位；构造一帧标准 8 位恒定信号作独立夹具。
function constant8BitFlac(): Buffer {
  const crc = (bytes: Buffer, width: number, polynomial: number): number => {
    let value = 0
    for (const byte of bytes) {
      value ^= byte << (width - 8)
      for (let i = 0; i < 8; i++) value = ((value << 1) ^ (value & (1 << (width - 1)) ? polynomial : 0)) & ((1 << width) - 1)
    }
    return value
  }
  const frameHeader = Buffer.from([0xff, 0xf8, 0x89, 0x02, 0x00])
  const frame = Buffer.concat([frameHeader, Buffer.from([crc(frameHeader, 8, 0x07), 0x00, 0xf8])])
  const footer = Buffer.alloc(2); footer.writeUInt16BE(crc(frame, 16, 0x8005))
  const info = Buffer.alloc(34)
  info.writeUInt16BE(256, 0); info.writeUInt16BE(256, 2)
  info.writeUIntBE(frame.length + 2, 4, 3); info.writeUIntBE(frame.length + 2, 7, 3)
  info.writeBigUInt64BE((44100n << 44n) | (7n << 36n) | 256n, 10)
  createHash('md5').update(Buffer.alloc(256, 0xf8)).digest().copy(info, 18)
  return Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0x00, 0x00, 34]), info, frame, footer])
}

async function run(): Promise<void> {
  const [directory, binary] = process.argv.slice(2)
  const paths = libraryPaths(directory, directory)
  await mkdir(paths.music, { recursive: true })
  let issueQueries = 0
  const db = new Database(join(directory, 'db.sqlite'), { verbose: sql => { if (String(sql).includes('WHERE c.error_info IS NOT NULL')) issueQueries++ } })
  db.pragma('foreign_keys = ON'); db.exec(SCHEMA_SQL)
  const files: string[] = []
  const cover = join(directory, 'cover.png')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', cover])
  for (const [i, format] of ['flac', 'mp3', 'wav', 'ogg', 'm4a'].entries()) {
    const name = `歌曲-${i}.${format}`, file = join(paths.music, name)
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2',
      ...(i === 0 || i === 4 ? ['-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : []), file])
    db.prepare('INSERT INTO songs (id, title, file_name) VALUES (?, ?, ?)').run(i + 1, `歌曲 ${i}`, name)
    files.push(file)
  }
  const firstBytes = await Promise.all(files.map(file => readFile(file)))
  const updates: AudioIntegrityProgressUpdate[] = []
  const scanner = new AudioIntegrityScanner(paths, () => db, binary, update => { updates.push(update) })
  scanner.start(); const first = scanner.progress.revision
  scanner.start(); assert.equal(scanner.progress.revision, first, 'duplicate start must reuse the task')
  const beforeScanQueries = issueQueries
  await scanner.completion
  assert.equal(issueQueries, beforeScanQueries, 'progress publishing must not query the entire issue list')
  assert.ok(updates.every(update => !('issues' in update) && update.issueChanges.length === 0), 'healthy scans publish counts without the issue list')
  assert.equal(scanner.progress.scanned, 5, JSON.stringify(scanner.progress))
  assert.equal(scanner.progress.issues.length, 0, JSON.stringify(scanner.progress))
  assert.deepEqual(await Promise.all(files.map(file => readFile(file))), firstBytes)
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.skipped, 5)
  db.exec("UPDATE songs SET title='new DB title' WHERE id=1")
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.skipped, 5, 'DB metadata does not alter the audio')
  console.log('PASS: five formats decode fully; unchanged files skip; source bytes are unchanged')

  assert.equal(await hasM4aCoverWithValidAudioTiming(files[4]), true)
  const missingTimescale = Buffer.from(firstBytes[4]), mdhd = missingTimescale.indexOf(Buffer.from('mdhd'))
  assert.ok(mdhd > 0); assert.equal(missingTimescale[mdhd + 4], 0)
  missingTimescale.writeUInt32BE(0, mdhd + 16)
  await writeFile(files[4], missingTimescale)
  assert.equal(await hasM4aCoverWithValidAudioTiming(files[4]), false)
  scanner.start([5]); await scanner.completion
  assert.equal(scanner.progress.issues.length, 1, 'real audio timescale problems must remain visible')
  assert.match(scanner.progress.issues[0].message, /timescale/)
  assert.ok(updates.some(update => update.issueChanges.some(change => change.songId === 5 && change.issue?.kind === 'problem')))
  updates.length = 0
  await writeFile(files[4], firstBytes[4]); scanner.start([5]); await scanner.completion
  assert.equal(scanner.progress.issues.length, 0)
  assert.deepEqual(updates.flatMap(update => update.issueChanges), [{ songId: 5, issue: null }], 'repair publishes one deletion instead of a full issue list')
  console.log('PASS: cover-only M4A timescale warnings are ignored; missing audio timing remains visible')

  // FLAC 尾部垃圾可产生诊断，但完整 PCM MD5 和采样数通过时不显示提示。
  await appendFile(files[0], Buffer.from('bad trailing data '.repeat(1200)))
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.scanned, 1)
  assert.equal(scanner.progress.issues.length, 0, JSON.stringify(scanner.progress))
  assert.equal((db.prepare('SELECT status FROM audio_integrity_scan_state WHERE song_id=1').get() as {status: string}).status, 'ok')
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.skipped, 5)
  // 没有可用的内置 MD5 时不能把同样的错误静默忽略。
  const noChecksum = Buffer.from(await readFile(files[0]))
  noChecksum.fill(0, 26, 42)
  await writeFile(files[0], noChecksum)
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.issues.length, 1)
  assert.match(scanner.progress.issues[0].message, /invalid|error|corrupt|header|sync|Error/i)
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.scanned, 1, 'unchanged problematic files must be retried')
  assert.equal(scanner.progress.skipped, 4)
  assert.equal(scanner.progress.issues.length, 1, 'unchanged problematic files must remain visible')
  clearAudioIntegrityScanState(db)
  const restarted = new AudioIntegrityScanner(paths, () => db, binary, () => {})
  assert.equal(restarted.progress.issues.length, 0, 'integrity results are cleared at application restart')
  await writeFile(files[0], firstBytes[0])
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.scanned, 5); assert.equal(scanner.progress.issues.length, 0)
  console.log('PASS: verified FLAC tails are silent; unverified errors persist across cached scans and restarts')

  for (const [kind, change] of [
    ['MD5', (bytes: Buffer) => { bytes[26] ^= 1 }],
    ['采样数量', (bytes: Buffer) => { bytes[25] ^= 1 }],
    ['音频', (bytes: Buffer) => { bytes[bytes.length - 100] ^= 0xff }]
  ] as const) {
    const damaged = Buffer.from(firstBytes[0]); change(damaged)
    await writeFile(files[0], damaged)
    scanner.start([1]); await scanner.completion
    assert.equal(scanner.progress.issues.length, 1, `${kind}: ${JSON.stringify(scanner.progress)}`)
    assert.match(scanner.progress.issues[0].message, /MD5|采样数量/)
  }
  await writeFile(files[0], firstBytes[0].subarray(0, firstBytes[0].length - 100))
  scanner.start([1]); await scanner.completion
  assert.equal(scanner.progress.issues.length, 1, 'truncated audio must not be hidden')
  await writeFile(files[0], firstBytes[0]); scanner.start([1]); await scanner.completion
  assert.equal(scanner.progress.issues.length, 0)
  console.log('PASS: MD5 mismatch, incorrect sample count, damaged frames and truncation remain visible')

  for (const bits of [8, 24, 32]) {
    const file = join(paths.music, `depth-${bits}.flac`), id = bits + 100
    if (bits === 8) await writeFile(file, constant8BitFlac())
    else execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2',
      '-sample_fmt', 's32', '-bits_per_raw_sample', String(bits), '-strict', 'experimental', file])
    const bytes = await readFile(file)
    assert.equal(Number((bytes.readBigUInt64BE(18) >> 36n) & 31n) + 1, bits)
    await appendFile(file, Buffer.from('bad trailing data '.repeat(1200)))
    db.prepare('INSERT INTO songs (id, title, file_name) VALUES (?, ?, ?)').run(id, `depth ${bits}`, `depth-${bits}.flac`)
    scanner.start([id]); await scanner.completion
    assert.equal(scanner.progress.issues.length, 0, `${bits}-bit: ${JSON.stringify(scanner.progress)}`)
    db.prepare('DELETE FROM songs WHERE id=?').run(id)
  }
  console.log('PASS: 8/24/32-bit FLAC checks use matching PCM depth without losing sample precision')

  const hidden = join(directory, 'hidden.mp3')
  await rename(files[1], hidden)
  scanner.start(); await scanner.completion
  assert.equal(scanner.progress.failed, 1); assert.match(scanner.progress.issues[0].message, /不存在/)
  await rename(hidden, files[1]); scanner.start(); await scanner.completion
  assert.equal(scanner.progress.scanned, 1); assert.equal(scanner.progress.issues.length, 0)
  db.exec("UPDATE audio_integrity_scan_state SET status='scanning' WHERE song_id=1")
  scanner.start(); await scanner.completion; assert.equal(scanner.progress.scanned, 1)
  db.exec("UPDATE audio_integrity_scan_state SET scanner_version='old' WHERE song_id=1")
  scanner.start(); await scanner.completion; assert.equal(scanner.progress.scanned, 1)
  const unavailable = new AudioIntegrityScanner(paths, () => db, join(directory, 'missing-binary'), () => {})
  unavailable.start(); await unavailable.completion
  assert.equal(unavailable.progress.status, 'failed'); assert.match(unavailable.progress.error!, /检查工具/)
  assert.equal(unavailable.progress.issues.length, 0, 'missing decoder must not mark all songs as damaged')
  console.log('PASS: missing audio, incomplete records and decoder upgrades retry; tool failure is a task error')

  // 相同大小、相同 mtime，字节不同：完整 SHA-256 仍然发现变化。
  const alt = join(directory, 'alternate.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2', alt])
  await copyFile(alt, files[2]); await utimes(files[2], new Date(0), new Date(0))
  scanner.start(); await scanner.completion; assert.equal(scanner.progress.scanned, 1)
  let cancelling: AudioIntegrityScanner
  cancelling = new AudioIntegrityScanner(paths, () => db, binary, p => {
    if (p.status === 'running' && p.phase === 'decoding') cancelling.cancel()
  })
  db.exec("UPDATE audio_integrity_scan_state SET status='scanning' WHERE song_id=1")
  cancelling.start(); await cancelling.completion
  assert.equal(cancelling.progress.status, 'cancelled'); assert.equal(cancelling.progress.completed, 0)
  assert.equal((db.prepare('SELECT status FROM audio_integrity_scan_state WHERE song_id=1').get() as {status: string}).status, 'scanning')
  scanner.start(); await scanner.completion; assert.equal(scanner.progress.scanned, 1)
  let changing: AudioIntegrityScanner, changed = false
  changing = new AudioIntegrityScanner(paths, () => db, binary, p => {
    if (p.status === 'running' && p.phase === 'decoding' && !changed) {
      changed = true
      // ctime 变化即可使本次结果失效，不修改音频内容。
      execFileSync(process.execPath, ['-e', 'require("fs").utimesSync(process.argv[1], new Date(), new Date())', files[0]])
    }
  })
  db.exec("UPDATE audio_integrity_scan_state SET status='scanning' WHERE song_id=1")
  changing.start([1]); await changing.completion
  assert.equal(changing.progress.failed, 1)
  assert.match(changing.progress.issues[0].message, /改变/)
  scanner.start(); await scanner.completion; assert.equal(scanner.progress.scanned, 1)
  db.prepare('DELETE FROM songs WHERE id=1').run()
  assert.equal((db.prepare('SELECT count(*) n FROM audio_integrity_scan_state WHERE song_id=1').get() as {n:number}).n, 0)
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
  console.log('PASS: cancellation and concurrent external changes retry; song deletion cascades; SQLite integrity is clean')
  db.close()
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
