import { useEffect, useRef, useState } from 'react'
import type { CoverResource, CoverUpdate } from '../../../shared/types'

/* 原图与缩略图共用精确失效订阅，加载和缓存策略各自保留。 */
export function useCoverVersion(resource?: CoverResource): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!resource) return
    const { kind, id } = resource
    const refresh = (event: Event): void => {
      const update = (event as CustomEvent<CoverUpdate>).detail
      const ids = kind === 'song' ? update?.songIds : kind === 'album' ? update?.albumIds : update?.artistIds
      if (ids?.includes(id)) setVersion(value => value + 1)
    }
    window.addEventListener('library:cover-updated', refresh)
    return () => window.removeEventListener('library:cover-updated', refresh)
  }, [resource?.kind, resource?.id])
  return version
}

/* 完整封面统一管理异步竞态与 Object URL 释放；不保留跨页面缓存。 */
export function useCoverUrl(cacheKey: string | number, load: () => Promise<Uint8Array | null>, resource?: CoverResource): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const version = useCoverVersion(resource)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setUrl(null)
    void loadRef.current().then(data => {
      if (cancelled || !data) return
      objectUrl = URL.createObjectURL(new Blob([data as BlobPart]))
      setUrl(objectUrl)
    }).catch(() => { /* 封面不可读时显示占位，不影响歌曲播放或列表。 */ })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [cacheKey, version])

  return url
}
