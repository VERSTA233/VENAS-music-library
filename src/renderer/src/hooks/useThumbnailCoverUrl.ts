import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoverResource } from '../../../shared/types'
import { acquireThumbnail, observeThumbnail, type ThumbnailLease } from '../thumbnailCache'
import { useCoverVersion } from './useCoverUrl'

export function useThumbnailCoverUrl(
  key: string,
  load: () => Promise<Uint8Array | null>,
  resource?: CoverResource
): { url: string | null; setElement: (element: HTMLDivElement | null) => void } {
  const [element, setElementState] = useState<HTMLDivElement | null>(null)
  const [nearby, setNearby] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const version = useCoverVersion(resource)
  const loadRef = useRef(load)
  loadRef.current = load
  const setElement = useCallback((node: HTMLDivElement | null) => setElementState(node), [])

  useEffect(() => {
    if (!element) return
    return observeThumbnail(element, setNearby)
  }, [element])

  useEffect(() => {
    if (!nearby) {
      setUrl(null)
      return
    }
    let cancelled = false
    let lease: ThumbnailLease | null = null
    setUrl(null)
    void acquireThumbnail(key, () => loadRef.current()).then((acquired) => {
      if (cancelled) {
        acquired.release()
        return
      }
      lease = acquired
      setUrl(acquired.url)
    }).catch(() => { if (!cancelled) setUrl(null) })
    return () => {
      cancelled = true
      lease?.release()
    }
  }, [key, nearby, version])

  return { url: nearby ? url : null, setElement }
}
