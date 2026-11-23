import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { parseFile } from 'music-metadata'
import { compileTestWriter, encodedMediaHash, inspectId3Tags, wavChunks } from '../scripts/audio-tag-test-utils.mjs'

const directory = await mkdtemp(join(tmpdir(), 'venas-id3-tag-tests-'))
const writer = compileTestWriter(directory)
after(() => rm(directory, { recursive: true, force: true }))

function syncsafe(value) { return Buffer.from([(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127]) }
function frame(id, body) {
  const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}
function text(value) { return Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(value, 'utf16le')]) }
function comment(value, description = '') { return frame('COMM', Buffer.concat([Buffer.from([1]), Buffer.from('eng'), Buffer.from([0xff, 0xfe]),
  Buffer.from(`${description}\0`, 'utf16le'), Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')])) }
function v23(frames) { const body = Buffer.concat(frames); return Buffer.concat([Buffer.from([73, 68, 51, 3, 0, 0]), syncsafe(body.length), body]) }
function chunk(id, data) { const h = Buffer.alloc(8); h.write(id); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]) }
function wav(tag, extraInfo = []) {
  const fmt = Buffer.alloc(16); fmt.writeUInt16LE(1); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(8000, 4); fmt.writeUInt32LE(16000, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14)
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('data', Buffer.alloc(1600)),
    chunk('LIST', Buffer.concat([Buffer.from('INFO'), chunk('ICMT', Buffer.from('163 key in WAV must stay\0')), ...extraInfo])),
    chunk('JUNK', Buffer.from('custom preserved block')), chunk('id3 ', tag)])
  const h = Buffer.alloc(8); h.write('RIFF'); h.writeUInt32LE(body.length, 4)
  return Buffer.concat([h, body])
}
const fields = { TITLE: '曲名', ARTIST: 'Artist A/Artist B', ALBUM: '专辑', DATE: '2026-11', TRACKNUMBER: '4', DISCNUMBER: '1', DISCTOTAL: '2',
  GENRE: 'G1/G2', MOOD: 'High/Inspire', ALBUMARTIST: 'X/Y', LABEL: 'L1/L2', WORK: 'W1/W2', GROUPING: 'T1/T2', LYRICS: '[00:01.00]歌词\n[00:02.00]下一句', RELEASETYPE: 'OST' }
function apply(format, path, values) {
  return JSON.parse(execFileSync(writer, [format, path, ...Object.entries(values).flat()], { encoding: 'utf8' }))
}
function expectedTags() { return { TIT2: ['曲名'], TPE1: ['Artist A/Artist B'], TALB: ['专辑'], TDRC: ['2026-11'], TRCK: ['4'], TPOS: ['1/2'], TCON: ['G1/G2'], TPE2: ['X/Y'],
  TMOO: ['High/Inspire'], 'TXXX:LABEL': ['L1/L2'], 'TXXX:WORK': ['W1/W2'], GRP1: ['T1/T2'], USLT: ['[00:01.00]歌词\n[00:02.00]下一句'], 'TXXX:RELEASETYPE': ['OST'] } }

test('WAV writes every requested ID3v2.4 field, TDRC, GRP1 and custom names; retains all ordinary chunks and comments', async () => {
  const file = join(directory, 'complex.wav')
  const original = wav(v23([frame('TIT2', text('Old')), comment('Ordinary comment'), comment('163 key must stay in WAV', 'source')]))
  await writeFile(file, original)
  assert.equal(apply('wav', file, fields).removedComments, 0)
  const actual = await readFile(file)
  const tags = inspectId3Tags(actual, 'wav')
  for (const [key, values] of Object.entries(expectedTags())) assert.deepEqual(tags[key], values, key)
  assert.deepEqual(tags.COMM, ['Ordinary comment', '163 key must stay in WAV'])
  assert.equal(encodedMediaHash(actual, 'wav'), encodedMediaHash(original, 'wav'))
  assert(wavChunks(actual).find(c => c.id === 'LIST').data.includes(Buffer.from('163 key in WAV must stay')))
  apply('wav', file, fields)
  assert.deepEqual(inspectId3Tags(await readFile(file), 'wav'), tags, 'Repeat writes must not add duplicate tags')
})

test('MP3 converts v2.3 to v2.4, removes only marked COMM and v1 comment, retains custom fields and track byte', async () => {
  const file = join(directory, 'complex.mp3')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.1', '-c:a', 'libmp3lame', '-write_id3v1', '0', '-id3v2_version', '0', file])
  const media = await readFile(file)
  const id3v1 = Buffer.alloc(128); id3v1.write('TAG'); id3v1.write('163 key truncated', 97); id3v1[125] = 0; id3v1[126] = 17
  const tag = v23([frame('TIT2', text('Old')), comment('Ordinary comment', 'note'), comment('prefix 163 key payload', 'netease'),
    frame('TXXX', text('CUSTOM\0contains 163 key but is not a comment'))])
  const original = Buffer.concat([tag, media, id3v1])
  await writeFile(file, original)
  assert.equal(apply('mp3', file, fields).removedComments, 2)
  const actual = await readFile(file)
  const tags = inspectId3Tags(actual, 'mp3')
  for (const [key, values] of Object.entries(expectedTags())) assert.deepEqual(tags[key], values, key)
  assert.deepEqual(tags.COMM, ['Ordinary comment'])
  assert.deepEqual(tags['TXXX:CUSTOM'], ['contains 163 key but is not a comment'])
  assert(actual.subarray(actual.length - 31, actual.length - 3).every(value => value === 0))
  assert.equal(actual[actual.length - 2], 17)
  assert.equal(encodedMediaHash(actual, 'mp3'), encodedMediaHash(original, 'mp3'))
})

test('empty database fields stay unchanged, old disc-total survives a disc-only update, ordinary MP3 v1 comments survive', async () => {
  const wavFile = join(directory, 'partial.wav')
  await writeFile(wavFile, wav(v23([frame('TPE1', text('Existing Artist')), frame('TPOS', text('1/3')), frame('TMOO', text('Existing Mood')), frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('und\0Existing lyrics')]))])))
  apply('wav', wavFile, { TITLE: 'New', DISCNUMBER: '2', DATE: '2026' })
  const tags = inspectId3Tags(await readFile(wavFile), 'wav')
  assert.deepEqual(tags.TPE1, ['Existing Artist'])
  assert.deepEqual(tags.TMOO, ['Existing Mood'])
  assert.deepEqual(tags.USLT, ['Existing lyrics'])
  assert.deepEqual(tags.TPOS, ['2/3'])
  assert.deepEqual(tags.TDRC, ['2026'])
  const mp3File = join(directory, 'ordinary.mp3')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.1', '-c:a', 'libmp3lame', '-id3v2_version', '0', mp3File])
  const body = await readFile(mp3File)
  const v1 = Buffer.alloc(128); v1.write('TAG'); v1.write('ordinary note', 97)
  await writeFile(mp3File, Buffer.concat([body, v1]))
  assert.equal(apply('mp3', mp3File, { TITLE: 'New' }).removedComments, 0)
  const result = await readFile(mp3File)
  assert.equal(result.toString('latin1', result.length - 31, result.length - 1).replace(/\0+$/, ''), 'ordinary note')
})

for (const format of ['mp3', 'wav']) {
  test(`${format}: database COMMENT replaces COMM, preserves exact text and remains stable on retry or omitted updates`, async () => {
    const file = join(directory, `comment.${format}`)
    const tag = v23([comment('Old', 'note'), comment('Duplicate', 'other'), frame('TXXX', text('CUSTOM\0untouched'))])
    if (format === 'mp3') {
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.1', '-c:a', 'libmp3lame', '-id3v2_version', '0', file])
      await writeFile(file, Buffer.concat([tag, await readFile(file)]))
    } else await writeFile(file, wav(tag))
    const original = await readFile(file)
    const value = '歌曲评论 / Comment\n第二行 = 内容'
    for (const values of [{ COMMENT: value }, { COMMENT: value }, { TITLE: 'Only title' }]) {
      apply(format, file, values)
      const actual = await readFile(file)
      const tags = inspectId3Tags(actual, format)
      assert.deepEqual(tags.COMM, [value])
      assert.deepEqual(tags['TXXX:CUSTOM'], ['untouched'])
      assert.equal(encodedMediaHash(actual, format), encodedMediaHash(original, format))
    }
  })
}

for (const format of ['mp3', 'wav']) {
  test(`${format}: album clearing removes fallback values, artist-only clearing retains the album, retries are stable`, async () => {
    const file = join(directory, `clear-album.${format}`)
    const tag = v23([frame('TALB', text('Old Album')), frame('TPE2', text('Old Artist')), frame('TDRC', text('2000')), frame('TPOS', text('2/3')), comment('Keep comment')])
    if (format === 'mp3') {
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.1', '-c:a', 'libmp3lame', '-id3v2_version', '0', file])
      const v1 = Buffer.alloc(128); v1.write('TAG'); v1.write('Old Album', 63); v1.write('ordinary note', 97)
      await writeFile(file, Buffer.concat([tag, await readFile(file), v1]))
    } else await writeFile(file, wav(tag, [chunk('IPRD', Buffer.from('Old Album\0'))]))
    const original = await readFile(file)
    apply(format, file, { ALBUM: 'Database Album', ALBUMARTIST: '' })
    let tags = inspectId3Tags(await readFile(file), format)
    assert.deepEqual(tags.TALB, ['Database Album'])
    assert.equal(tags.TPE2, undefined)
    for (let i = 0; i < 2; i++) {
      apply(format, file, { ALBUM: '', ALBUMARTIST: '' })
      const bytes = await readFile(file)
      tags = inspectId3Tags(bytes, format)
      assert.equal(tags.TALB, undefined)
      assert.equal(tags.TPE2, undefined)
      assert.deepEqual(tags.TDRC, ['2000'])
      assert.deepEqual(tags.TPOS, ['2/3'])
      assert.deepEqual(tags.COMM, ['Keep comment'])
      const metadata = await parseFile(file)
      assert.equal(metadata.common.album, undefined)
      assert.equal(metadata.common.albumartist, undefined)
      assert.equal(encodedMediaHash(bytes, format, true), encodedMediaHash(original, format, true))
      if (format === 'mp3') assert(bytes.subarray(bytes.length - 65, bytes.length - 35).every(value => value === 0))
      else {
        const info = wavChunks(bytes).find(chunk => chunk.id === 'LIST').data
        assert(!info.includes(Buffer.from('IPRD')))
        assert(info.includes(Buffer.from('163 key in WAV must stay')))
      }
    }
  })
}

test('refuses malformed files and empty overwrite values', async () => {
  const file = join(directory, 'invalid.wav')
  await writeFile(file, 'invalid file')
  assert.notEqual(spawnSync(writer, ['wav', file, 'TITLE', 'New']).status, 0)
  assert.equal(await readFile(file, 'utf8'), 'invalid file')
  await writeFile(file, wav(v23([])))
  const original = await readFile(file)
  assert.notEqual(spawnSync(writer, ['wav', file, 'TITLE', '']).status, 0)
  assert.deepEqual(await readFile(file), original)
})
