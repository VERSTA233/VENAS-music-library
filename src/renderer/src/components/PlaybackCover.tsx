import type { PlayerTrack } from '../stores/playerStore'
import { useCoverUrl } from '../hooks/useCoverUrl'

interface PlaybackCoverProps {
  track: PlayerTrack
  className: string
  fadeIn?: boolean
}

/* 播放器封面遵循文件优先、缓存兜底的顺序；Object URL 在曲目切换时立即释放。 */
export default function PlaybackCover({ track, className, fadeIn = false }: PlaybackCoverProps): React.JSX.Element {
  const url = useCoverUrl(
    JSON.stringify([track.key, track.songId, track.mediaUrl, track.contentVersion]),
    async () => track.songId != null
        ? (await window.api.songs.embeddedCover(track.songId)) ?? (await window.api.songs.cover(track.songId))
        : track.appendEntry
          ? window.api.append.cover(track.appendEntry.fileName)
          : null,
    track.songId == null ? undefined : { kind: 'song', id: track.songId }
  )

  return url ? (
    <img key={url} src={url} className={`${className} select-none${fadeIn ? ' playback-cover-fade' : ''}`} alt="" draggable={false}
      onLoad={fadeIn ? event => { event.currentTarget.dataset.loaded = 'true' } : undefined} />
  ) : (
    <div className={`${className} bg-neutral-800/90 ring-1 ring-white/10`} aria-label="无封面" />
  )
}
