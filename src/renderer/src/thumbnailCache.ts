import type { CoverUpdate } from '../../shared/types'

interface ThumbnailEntry {
  url: string | null
  bytes: number
  users: number
  invalidated: boolean
}

export interface ThumbnailLease {
  url: string | null
  release: () => void
}

const MAX_ENTRIES = 96
const MAX_BYTES = 24 * 1024 * 1024
const entries = new Map<string, ThumbnailEntry>()
const pending = new Map<string, Promise<ThumbnailEntry>>()
let totalBytes = 0

function dispose(entry: ThumbnailEntry): void {
  if (entry.url) URL.revokeObjectURL(entry.url)
}

function evictUnused(): void {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_BYTES) break
    if (entry.users > 0) continue
    entries.delete(key)
    totalBytes -= entry.bytes
    dispose(entry)
  }
}

function invalidate(key: string): void {
  const entry = entries.get(key)
  if (entry) {
    entries.delete(key)
    totalBytes -= entry.bytes
    entry.invalidated = true
    if (entry.users === 0) dispose(entry)
  }
  pending.delete(key)
}

/* 只缓存列表缩略图；播放器封面仍直接读取源音频，且不会占用这个有界缓存。 */
export async function acquireThumbnail(key: string, load: () => Promise<Uint8Array | null>): Promise<ThumbnailLease> {
  let entry = entries.get(key)
  if (!entry) {
    let task = pending.get(key)
    if (!task) {
      task = Promise.resolve().then(load).then((bytes) => {
        const created: ThumbnailEntry = {
          url: bytes ? URL.createObjectURL(new Blob([bytes as BlobPart])) : null,
          bytes: bytes?.byteLength ?? 0,
          users: 0,
          invalidated: pending.get(key) !== task
        }
        if (!created.invalidated) {
          entries.set(key, created)
          totalBytes += created.bytes
        }
        return created
      }).finally(() => {
        if (pending.get(key) === task) pending.delete(key)
      })
      pending.set(key, task)
    }
    entry = await task
  }

  entry.users += 1
  if (entries.get(key) === entry) {
    entries.delete(key)
    entries.set(key, entry)
  }
  evictUnused()
  let released = false
  return {
    url: entry.url,
    release: () => {
      if (released) return
      released = true
      entry.users -= 1
      if (entry.invalidated && entry.users === 0) dispose(entry)
      else evictUnused()
    }
  }
}

export function invalidateUpdatedThumbnails(update: CoverUpdate): void {
  for (const id of update.songIds) invalidate(`song:${id}`)
  for (const id of update.albumIds) invalidate(`album:${id}`)
  for (const id of update.artistIds) invalidate(`artist:${id}`)
}

type VisibilityCallback = (visible: boolean) => void
const observers = new Map<Element, VisibilityCallback>()
let observer: IntersectionObserver | null = null

export function observeThumbnail(element: Element, callback: VisibilityCallback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true)
    return () => undefined
  }
  observer ??= new IntersectionObserver((changes) => {
    for (const change of changes) observers.get(change.target)?.(change.isIntersecting)
  }, { rootMargin: '400px 0px' })
  observers.set(element, callback)
  observer.observe(element)
  return () => {
    observer?.unobserve(element)
    observers.delete(element)
  }
}
