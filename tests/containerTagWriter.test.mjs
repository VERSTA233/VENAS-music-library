import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { parseFile } from 'music-metadata'
import { compileTestWriter, decodeHash, encodedMediaHash, inspectMp4Tags, mp4Atoms, oggPackets } from '../scripts/audio-tag-test-utils.mjs'

const directory = await mkdtemp(join(tmpdir(), 'venas-container-tags-'))
const writer = compileTestWriter(directory)
after(() => rm(directory, { recursive: true, force: true }))
const fields = { TITLE: '曲名', ARTIST: 'A/B', ALBUM: '专辑', DATE: '2026-11', TRACKNUMBER: '4', DISCNUMBER: '1', DISCTOTAL: '2',
  GENRE: 'G1/G2', MOOD: 'High/Inspire', ALBUMARTIST: 'X/Y', LABEL: '厂牌 A/Label B', WORK: 'W1/W2', GROUPING: 'T1/T2',
  LYRICS: '[00:01.00]歌词\n[00:02.00]下一句', COMMENT: '歌曲评论 / Comment\n第二行 = 内容', RELEASETYPE: 'OST' }
const mp4Map = { TITLE: '©nam', ARTIST: '©ART', ALBUM: '©alb', DATE: '©day', GENRE: '©gen', MOOD: '----:com.apple.iTunes:MOOD',
  ALBUMARTIST: 'aART', LABEL: '----:com.apple.iTunes:LABEL', WORK: '©wrk', GROUPING: '©grp', LYRICS: '©lyr', COMMENT: '©cmt', RELEASETYPE: '----:com.apple.iTunes:RELEASETYPE' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==', 'base64')
function apply(format, path, values) {
  return JSON.parse(execFileSync(writer, [format, path, ...Object.entries(values).flat()], { encoding: 'utf8' }))
}
function atom(type, payload) {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4, 4, 'latin1')
  return Buffer.concat([header, payload])
}
function data(type, payload) { const h = Buffer.alloc(8); h.writeUInt32BE(type); return atom('data', Buffer.concat([h, payload])) }
function withMp4Extras(bytes) {
  // FFmpeg defaults to moov after mdat: changing metadata size cannot invalidate sample offsets.
  const atoms = mp4Atoms(bytes)
  assert(atoms.findIndex(a => a.type === 'mdat') < atoms.findIndex(a => a.type === 'moov'))
  const extra = Buffer.concat([atom('covr', data(14, png)), atom('----', Buffer.concat([
    atom('mean', Buffer.concat([Buffer.alloc(4), Buffer.from('com.apple.iTunes')])),
    atom('name', Buffer.concat([Buffer.alloc(4), Buffer.from('CUSTOM')])), data(1, Buffer.from('163 key unrelated custom must stay'))]))])
  function rewrite(list, depth = 0) {
    return Buffer.concat(list.map(a => {
      if (a.type === 'ilst') return atom(a.type, Buffer.concat([a.data, extra]))
      if (['moov', 'udta', 'meta'].includes(a.type)) {
        assert(depth < 4)
        return atom(a.type, Buffer.concat([...(a.type === 'meta' ? [a.data.subarray(0, 4)] : []), rewrite(mp4Atoms(a.data, a.type === 'meta' ? 4 : 0), depth + 1)]))
      }
      return atom(a.type, a.data)
    }))
  }
  return rewrite(atoms)
}
function uint32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
function pictureComment() {
  const mime = Buffer.from('image/png')
  return Buffer.concat([uint32(3), uint32(mime.length), mime, uint32(0), uint32(1), uint32(1), uint32(32), uint32(0), uint32(png.length), png,
    Buffer.from('trailing bytes must remain verbatim')]).toString('base64')
}
function vorbisComments(bytes) {
  const packet = oggPackets(bytes)[1]
  let position = 7
  const vendorLength = packet.readUInt32LE(position); position += 4
  const vendor = packet.subarray(position, position + vendorLength); position += vendorLength
  const count = packet.readUInt32LE(position); position += 4
  const entries = []
  for (let i = 0; i < count; i++) {
    const size = packet.readUInt32LE(position); position += 4
    entries.push(packet.toString('utf8', position, position + size)); position += size
  }
  return { vendor, entries }
}
async function fixture(format, name) {
  const file = join(directory, `${name}.${format}`)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.15', '-ac', '2',
    '-c:a', format === 'ogg' ? 'vorbis' : 'aac', ...(format === 'ogg' ? ['-strict', 'experimental'] : []), '-metadata', 'comment=163 key ordinary comment must stay',
    '-metadata', 'date=1999-12-31', '-metadata', 'track=2/9', '-metadata', 'disc=2/7', file])
  if (format === 'm4a') await writeFile(file, withMp4Extras(await readFile(file)))
  else apply(format, file, { CUSTOM: '163 key unrelated custom must stay', METADATA_BLOCK_PICTURE: pictureComment() })
  return file
}

for (const format of ['ogg', 'm4a']) {
  test(`${format}: all fields including LABEL/MOOD, Unicode slash values, exact date precision, pictures and audio survive repeated writes`, async () => {
    const file = await fixture(format, 'complete')
    const before = await readFile(file)
    const originalDecode = decodeHash(file)
    const pictureBefore = (await parseFile(file)).common.picture
    assert.equal(pictureBefore.length, 1)
    apply(format, file, fields)
    const actualBytes = await readFile(file)
    const metadata = await parseFile(file)
    if (format === 'm4a') {
      const tags = inspectMp4Tags(actualBytes)
      for (const [key, value] of Object.entries(fields)) if (mp4Map[key]) assert.deepEqual(tags[mp4Map[key]], [value], key)
      assert.deepEqual(tags.trkn, [[4, 9]], 'Track total must survive')
      assert.deepEqual(tags.disk, [[1, 2]])
      const oldTags = inspectMp4Tags(before)
      for (const key of ['covr', '----:com.apple.iTunes:CUSTOM']) assert.deepEqual(tags[key], oldTags[key], key)
    } else {
      const oldTags = vorbisComments(before), tags = vorbisComments(actualBytes)
      assert.deepEqual(tags.vendor, oldTags.vendor)
      for (const [key, value] of Object.entries(fields)) assert.deepEqual(tags.entries.filter(e => e.startsWith(`${key}=`)), [`${key}=${value}`], key)
      for (const entry of oldTags.entries) if (!Object.keys(fields).includes(entry.slice(0, entry.indexOf('=')).toUpperCase())) assert(tags.entries.includes(entry), 'Unchanged Vorbis comment must survive verbatim')
    }
    assert.deepEqual(metadata.common.picture, pictureBefore)
    assert.equal(encodedMediaHash(actualBytes, format), encodedMediaHash(before, format))
    assert.deepEqual(decodeHash(file), originalDecode)
    apply(format, file, fields)
    const repeated = await readFile(file)
    if (format === 'ogg') assert.deepEqual(vorbisComments(repeated), vorbisComments(actualBytes))
    else assert.deepEqual(inspectMp4Tags(repeated), inspectMp4Tags(actualBytes))
    assert.equal(encodedMediaHash(repeated, format), encodedMediaHash(before, format))
  })

  test(`${format}: missing values preserve original fields and date precision is never expanded`, async () => {
    const file = await fixture(format, 'partial')
    const before = await readFile(file)
    apply(format, file, { TITLE: 'Only title', DISCNUMBER: '3' })
    let bytes = await readFile(file)
    if (format === 'm4a') {
      const tags = inspectMp4Tags(bytes)
      assert.deepEqual(tags['©day'], ['1999-12-31'])
      assert.deepEqual(tags.disk, [[3, 7]])
      assert.deepEqual(tags['©cmt'], inspectMp4Tags(before)['©cmt'])
    } else assert(vorbisComments(bytes).entries.some(e => e.toUpperCase() === 'DATE=1999-12-31'))
    if (format === 'ogg') {
      const comments = bytes => vorbisComments(bytes).entries.filter(entry => /^(COMMENT|DESCRIPTION)=/i.test(entry))
      assert.deepEqual(comments(bytes), comments(before))
    }
    for (const date of ['2026', '2026-11', '2026-11-06']) {
      apply(format, file, { DATE: date })
      bytes = await readFile(file)
      if (format === 'm4a') assert.deepEqual(inspectMp4Tags(bytes)['©day'], [date])
      else assert.deepEqual(vorbisComments(bytes).entries.filter(e => e.startsWith('DATE=')), [`DATE=${date}`])
    }
  })

  test(`${format}: clears album and album artist without disturbing cover, audio or other fields`, async () => {
    const file = await fixture(format, 'clear-album')
    apply(format, file, { ALBUM: 'Old Album', ALBUMARTIST: 'Old Artist' })
    const original = await readFile(file)
    const metadata = await parseFile(file)
    const audio = decodeHash(file)
    const read = async () => {
      const bytes = await readFile(file)
      const tags = format === 'm4a' ? inspectMp4Tags(bytes) : Object.fromEntries(vorbisComments(bytes).entries.map(entry => {
        const at = entry.indexOf('='); return [entry.slice(0, at).toUpperCase(), [entry.slice(at + 1)]]
      }))
      assert.deepEqual((await parseFile(file)).common.picture, metadata.common.picture)
      assert.equal(encodedMediaHash(bytes, format), encodedMediaHash(original, format))
      return tags
    }
    const albumKey = format === 'm4a' ? '©alb' : 'ALBUM'
    const artistKey = format === 'm4a' ? 'aART' : 'ALBUMARTIST'
    apply(format, file, { ALBUM: 'Database Album', ALBUMARTIST: '' })
    let tags = await read()
    assert.deepEqual(tags[albumKey], ['Database Album'])
    assert.equal(tags[artistKey], undefined)
    for (let i = 0; i < 2; i++) {
      apply(format, file, { ALBUM: '', ALBUMARTIST: '' })
      tags = await read()
      assert.equal(tags[albumKey], undefined)
      assert.equal(tags[artistKey], undefined)
    }
    assert.deepEqual(decodeHash(file), audio)
    assert.deepEqual((await parseFile(file)).common.disk, metadata.common.disk)
  })
}

test('rejects invalid OGG/M4A and unsupported Opus without modifying inputs', async () => {
  for (const format of ['ogg', 'm4a']) {
    const path = join(directory, `invalid.${format}`)
    await writeFile(path, 'Invalid input')
    assert.notEqual(spawnSync(writer, [format, path, 'TITLE', 'New']).status, 0)
    assert.equal(await readFile(path, 'utf8'), 'Invalid input')
  }
  const opus = join(directory, 'opus.ogg')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.1', '-c:a', 'libopus', opus])
  const before = await readFile(opus)
  assert.notEqual(spawnSync(writer, ['ogg', opus, 'TITLE', 'New']).status, 0)
  assert.deepEqual(await readFile(opus), before)
})
