import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acquireThumbnail, invalidateUpdatedThumbnails, observeThumbnail } from '../src/renderer/src/thumbnailCache'

test('visible thumbnails reuse one read and one URL across unmounts', async () => {
  let reads = 0
  const load = async (): Promise<Uint8Array> => {
    reads += 1
    return new Uint8Array([1, 2, 3])
  }
  const first = await acquireThumbnail('song:thumbnail-reuse', load)
  const second = await acquireThumbnail('song:thumbnail-reuse', load)
  assert.equal(reads, 1)
  assert.equal(first.url, second.url)
  first.release()
  second.release()
  const third = await acquireThumbnail('song:thumbnail-reuse', load)
  assert.equal(third.url, first.url)
  assert.equal(reads, 1)
  third.release()
})

test('a changed cover refreshes only that song and releases the old URL', async () => {
  let reads = 0
  const load = async (): Promise<Uint8Array> => new Uint8Array([++reads])
  const original = await acquireThumbnail('song:42', load)
  const oldUrl = original.url
  const untouched = await acquireThumbnail('song:43', load)
  const otherUrl = untouched.url
  invalidateUpdatedThumbnails({ songIds: [42], albumIds: [], artistIds: [] })
  const updated = await acquireThumbnail('song:42', load)
  assert.notEqual(updated.url, oldUrl)
  assert.equal(reads, 3)
  original.release()
  untouched.release()
  updated.release()
  const existing = await acquireThumbnail('song:43', load)
  assert.equal(existing.url, otherUrl)
  assert.equal(reads, 3)
  existing.release()
})

test('artist and album updates invalidate only their own thumbnail kinds', async () => {
  let reads = 0
  const load = async (): Promise<Uint8Array> => new Uint8Array([++reads])
  const artist = await acquireThumbnail('artist:7', load)
  const album = await acquireThumbnail('album:7', load)
  const song = await acquireThumbnail('song:7', load)
  const artistUrl = artist.url
  const albumUrl = album.url
  const songUrl = song.url
  artist.release()
  album.release()
  song.release()

  invalidateUpdatedThumbnails({ songIds: [], albumIds: [7], artistIds: [7] })
  const refreshedArtist = await acquireThumbnail('artist:7', load)
  const refreshedAlbum = await acquireThumbnail('album:7', load)
  const unchangedSong = await acquireThumbnail('song:7', load)
  assert.notEqual(refreshedArtist.url, artistUrl)
  assert.notEqual(refreshedAlbum.url, albumUrl)
  assert.equal(unchangedSong.url, songUrl)
  assert.equal(reads, 5)
  refreshedArtist.release()
  refreshedAlbum.release()
  unchangedSong.release()
})

test('viewport observer defers loading until an item is near the viewport', () => {
  const original = globalThis.IntersectionObserver
  let callback: IntersectionObserverCallback | undefined
  const observed: Element[] = []
  class MockObserver {
    constructor(onChange: IntersectionObserverCallback) { callback = onChange }
    observe(element: Element): void { observed.push(element) }
    unobserve(element: Element): void { observed.splice(observed.indexOf(element), 1) }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: MockObserver })
  try {
    const element = {} as Element
    const visibility: boolean[] = []
    const stop = observeThumbnail(element, visible => visibility.push(visible))
    assert.deepEqual(observed, [element])
    assert.deepEqual(visibility, [])
    callback?.([{ target: element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    assert.deepEqual(visibility, [true])
    stop()
    assert.deepEqual(observed, [])
  } finally {
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: original })
  }
})
