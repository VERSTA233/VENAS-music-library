import { useEffect, useState } from 'react'
import type { PlayerTrack } from '../stores/playerStore'

interface PlaybackCoverProps {
  track: PlayerTrack
  className: string
}

/* 播放器封面遵循文件优先、缓存兜底的顺序；Object URL 在曲目切换时立即释放。 */
export default function PlaybackCover({ track, className }: PlaybackCoverProps): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setUrl(null)

    async function load(): Promise<void> {
      const data = track.songId != null
        ? (await window.api.songs.embeddedCover(track.songId)) ?? (await window.api.songs.cover(track.songId))
        : track.appendEntry
          ? await window.api.append.cover(track.appendEntry.fileName)
          : null
      if (cancelled || !data) return
      objectUrl = URL.createObjectURL(new Blob([data as BlobPart]))
      setUrl(objectUrl)
    }

    load().catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [track.key, track.songId, track.appendEntry])

  return url ? (
    <img src={url} className={`${className} select-none`} alt="" draggable={false} />
  ) : (
    <div className={`${className} bg-neutral-800/90 ring-1 ring-white/10`} aria-label="无封面" />
  )
}
