import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildFlacTagValues } from '../src/main/library/audioTagValues.ts'
import { writeFlacTagCopy } from '../src/main/library/flacTags.ts'
import type { SongDetail } from '../src/shared/types.ts'

function comments(values: string[]): Buffer {
  function length(value: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b }
  const vendor = Buffer.from('Original encoder 日本語')
  return Buffer.concat([length(vendor.length), vendor, length(values.length), ...values.flatMap((value) => {
    const b = Buffer.from(value); return [length(b.length), b]
  })])
}

function fixtureBytes(values?: string[], extra: { type: number; data: Buffer }[] = []): Buffer {
  const blocks = [{ type: 0, data: Buffer.alloc(34, 0x12) },
    ...(values ? [{ type: 4, data: comments(values) }] : []), ...extra]
  return Buffer.concat([Buffer.from('fLaC'), ...blocks.flatMap((block, i) => {
    const header = Buffer.alloc(4)
    header[0] = block.type | (i === blocks.length - 1 ? 0x80 : 0)
    header.writeUIntBE(block.data.length, 1, 3)
    return [header, block.data]
  }), Buffer.from([0xff, 0xf8, 0x00, 0x41, 0x00, 0x99])])
}

async function fixture(run: (source: string, output: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'venas-flac-tags-test-'))
  try { await run(join(root, 'source.flac'), join(root, 'output.flac')) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('maps every requested FLAC field, ordered artists without roles, slash values and exact date precision', () => {
  const song = {
    title: '曲名', lyric: '[00:01.00]歌詞', comment: '歌曲评论\n第二行',
    artists: [{ name: 'B', order: 2, role: 'Featured' }, { name: 'A', order: 1, role: 'Remixer' }],
    tags: [{ name: 'G1', tag_type: 'Genre' }, { name: 'G2', tag_type: 'genre' }, { name: 'W', tag_type: 'Work' }, { name: 'T1', tag_type: 'Theme' }, { name: 'T2', tag_type: 'Theme' }, { name: 'High', tag_type: 'Mood' }, { name: 'Inspire', tag_type: 'mood' }, { name: '忽略', tag_type: 'Playlist' }],
    album: { title: '专辑', release_date: '2026-11', track_number: 4, disc_number: 1, total_discs: 2, album_type: 'EP',
      artists: [{ name: 'Y', order: 2 }, { name: 'X', order: 1 }], labels: [{ name: 'L2', order: 2 }, { name: 'L1', order: 1 }] }
  } as SongDetail
  assert.deepEqual(buildFlacTagValues(song), {
    TITLE: '曲名', ARTIST: 'A/B', ALBUM: '专辑', DATE: '2026-11', TRACKNUMBER: '4', DISCNUMBER: '1', DISCTOTAL: '2',
    GENRE: 'G1/G2', MOOD: 'High/Inspire', ALBUMARTIST: 'X/Y', LABEL: 'L1/L2', WORK: 'W', GROUPING: 'T1/T2', LYRICS: '[00:01.00]歌詞', COMMENT: '歌曲评论\n第二行', RELEASETYPE: 'EP'
  })
  assert.equal(song.artists[0].name, 'B', 'Mapping must not reorder application state')
  for (const date of ['2026', '2026-11', '2026-11-06']) {
    song.album!.release_date = date
    assert.equal(buildFlacTagValues(song).DATE, date)
  }
  song.album!.artists = []
  assert.equal(buildFlacTagValues(song).ALBUM, '专辑')
  assert.equal(buildFlacTagValues(song).ALBUMARTIST, '')
  song.album = null; song.artists = []; song.tags = []; song.lyric = null
  for (const empty of [null, '', ' \n ']) {
    song.comment = empty
    assert.deepEqual(buildFlacTagValues(song), { TITLE: '曲名', ALBUM: '', ALBUMARTIST: '' })
  }
})

test('replaces all occurrences of selected tags, retains empty-database fields and only removes matching DESCRIPTION entries', async () => {
  await fixture(async (source, output) => {
    const original = fixtureBytes(['title=Old', 'TITLE=Duplicate', 'ARTIST=Old Artist', 'LYRICS=Existing lyrics',
      'COMMENT=163 key must remain in FLAC COMMENT', 'DESCRIPTION=普通描述', 'description=prefix 163 key payload',
      'DESCRIPTION=163 key another', 'DESCRIPTION=Keep=equals', 'MOOD=Old', 'mood=Duplicate', 'CUSTOM=untouched'])
    await writeFile(source, original)
    const result = await writeFlacTagCopy(source, output, { TITLE: '新曲名', MOOD: 'High/Inspire', DISCNUMBER: '1', DISCTOTAL: '2' })
    assert.deepEqual(result.tags.TITLE, ['新曲名'])
    assert.deepEqual(result.tags.MOOD, ['High/Inspire'])
    assert.deepEqual(result.tags.ARTIST, ['Old Artist'])
    assert.deepEqual(result.tags.LYRICS, ['Existing lyrics'])
    assert.deepEqual(result.tags.COMMENT, ['163 key must remain in FLAC COMMENT'])
    assert.deepEqual(result.tags.DESCRIPTION, ['普通描述', 'Keep=equals'])
    assert.deepEqual(result.tags.CUSTOM, ['untouched'])
    assert.equal(result.removedDescriptions, 2)
    assert.deepEqual(await readFile(source), original)
    const second = join(output, '..', 'second.flac')
    const rerun = await writeFlacTagCopy(output, second, { TITLE: '新曲名', MOOD: 'High/Inspire', DISCNUMBER: '1', DISCTOTAL: '2' })
    assert.equal(rerun.removedDescriptions, 0)
    assert.deepEqual(await readFile(second), await readFile(output), 'Repeated export must not grow duplicate tags')
  })
})

test('preserves picture, STREAMINFO, application, seektable, padding, vendor and exact encoded audio bytes', async () => {
  await fixture(async (source, output) => {
    const extra = [{ type: 6, data: Buffer.from('embedded picture bytes') }, { type: 2, data: Buffer.from('application data') },
      { type: 3, data: Buffer.alloc(18) }, { type: 1, data: Buffer.alloc(42) }]
    const original = fixtureBytes(['TITLE=Old'], extra)
    await writeFile(source, original)
    const result = await writeFlacTagCopy(source, output, { TITLE: 'Much longer replacement 曲名' })
    const actual = await readFile(output)
    assert(actual.subarray(-6).equals(original.subarray(-6)))
    assert(actual.subarray(8, 42).equals(original.subarray(8, 42)))
    for (const block of extra) assert(actual.includes(block.data))
    assert(actual.includes(Buffer.from('Original encoder 日本語')))
    assert.equal(result.audioSha256.length, 64)
    assert.equal(result.preservedMetadataSha256.length, 64)
  })
})

test('inserts missing Vorbis Comment even when the original final block is a picture', async () => {
  await fixture(async (source, output) => {
    await writeFile(source, fixtureBytes(undefined, [{ type: 6, data: Buffer.from('picture') }]))
    const result = await writeFlacTagCopy(source, output, { TITLE: 'Added' })
    assert.deepEqual(result.tags.TITLE, ['Added'])
    assert((await readFile(output)).includes(Buffer.from('picture')))
  })
})

test('never overwrites an existing destination or the source itself', async () => {
  await fixture(async (source, output) => {
    const original = fixtureBytes(['TITLE=Old'])
    await writeFile(source, original)
    await writeFile(output, 'keep destination')
    await assert.rejects(writeFlacTagCopy(source, output, { TITLE: 'New' }), { code: 'EEXIST' })
    await assert.rejects(writeFlacTagCopy(source, source, { TITLE: 'New' }), { code: 'EEXIST' })
    assert.equal(await readFile(output, 'utf8'), 'keep destination')
    assert.deepEqual(await readFile(source), original)
  })
})

test('rejects malformed or truncated metadata without touching source or creating output', async () => {
  await fixture(async (source, output) => {
    const valid = fixtureBytes(['TITLE=Old'])
    const badComment = Buffer.from(valid); badComment.writeUInt32LE(0xffffffff, 46)
    for (const bytes of [Buffer.from('not flac'), valid.subarray(0, 20), badComment]) {
      await writeFile(source, bytes)
      await assert.rejects(writeFlacTagCopy(source, output, { TITLE: 'New' }))
      assert.deepEqual(await readFile(source), bytes)
      await assert.rejects(readFile(output), { code: 'ENOENT' })
    }
  })
})

test('overwrites COMMENT when provided, preserving unrelated descriptions and exact Unicode text', async () => {
  await fixture(async (source, output) => {
    const original = fixtureBytes(['COMMENT=old', 'comment=duplicate', 'DESCRIPTION=ordinary description', 'DESCRIPTION=163 key payload'])
    await writeFile(source, original)
    const value = '歌曲评论 / Comment\n第二行 = 内容'
    const result = await writeFlacTagCopy(source, output, { COMMENT: value })
    assert.deepEqual(result.tags.COMMENT, [value])
    assert.deepEqual(result.tags.DESCRIPTION, ['ordinary description'])
    assert.equal(result.removedDescriptions, 1)
    assert.deepEqual(await readFile(source), original)
    const second = join(output, '..', 'second.flac')
    await writeFlacTagCopy(output, second, { COMMENT: value })
    assert.deepEqual(await readFile(second), await readFile(output))
  })
})

test('clears absent album fields, preserves other metadata, and supports artist-only clear and retries', async () => {
  await fixture(async (source, output) => {
    const original = fixtureBytes(['ALBUM=Old', 'album=duplicate', 'ALBUMARTIST=Old Artist', 'albumartist=duplicate', 'DATE=2000', 'LABEL=Keep', 'DISCNUMBER=2'])
    await writeFile(source, original)
    const artistOnly = await writeFlacTagCopy(source, output, { ALBUM: 'Database Album', ALBUMARTIST: '' })
    assert.deepEqual(artistOnly.tags.ALBUM, ['Database Album'])
    assert.equal(artistOnly.tags.ALBUMARTIST, undefined)
    const cleared = join(output, '..', 'cleared.flac')
    const result = await writeFlacTagCopy(output, cleared, { ALBUM: '', ALBUMARTIST: '' })
    assert.equal(result.tags.ALBUM, undefined)
    assert.equal(result.tags.ALBUMARTIST, undefined)
    assert.deepEqual(result.tags.DATE, ['2000'])
    assert.deepEqual(result.tags.LABEL, ['Keep'])
    assert.deepEqual(result.tags.DISCNUMBER, ['2'])
    const retry = join(output, '..', 'retry.flac')
    await writeFlacTagCopy(cleared, retry, { ALBUM: '', ALBUMARTIST: '' })
    assert.deepEqual(await readFile(retry), await readFile(cleared))
    assert.deepEqual(await readFile(source), original)
  })
})

test('rejects unrelated empty updates, DESCRIPTION overwrites and invalid field names', async () => {
  await fixture(async (source, output) => {
    const original = fixtureBytes(['COMMENT=keep'])
    await writeFile(source, original)
    for (const tags of [{ TITLE: '' }, { COMMENT: '' }, { DESCRIPTION: 'remove?' }, { 'BAD=KEY': 'value' }]) {
      await assert.rejects(writeFlacTagCopy(source, output, tags))
      assert.deepEqual(await readFile(source), original)
      await assert.rejects(readFile(output), { code: 'ENOENT' })
    }
  })
})
