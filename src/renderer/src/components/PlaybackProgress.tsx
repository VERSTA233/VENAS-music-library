import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { formatTime, useSmoothPlaybackTime } from '../playbackHelpers'

interface PlaybackProgressProps {
  currentTime: number
  duration: number
  isPlaying: boolean
  onSeek: (time: number) => void
  trailing?: ReactNode
}

/*
 * 两个播放器布局共用的进度条：拖动期间只显示用户预览值，松手后提交一次 seek，
 * 避免平滑插值和 audio 的 timeupdate 在拖动过程中互相覆盖。
 */
export default function PlaybackProgress({ currentTime, duration, isPlaying, onSeek, trailing }: PlaybackProgressProps): React.JSX.Element {
  const smoothTime = useSmoothPlaybackTime(currentTime, isPlaying, duration)
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const previewRef = useRef<number | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const commitTimerRef = useRef<number | null>(null)
  const displayedTime = previewTime ?? smoothTime
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (displayedTime / duration) * 100)) : 0

  useEffect(() => {
    const pendingTime = pendingSeekRef.current
    if (pendingTime == null || Math.abs(currentTime - pendingTime) > 0.15) return
    pendingSeekRef.current = null
    setPreviewTime(null)
  }, [currentTime])

  useEffect(() => {
    if (duration > 0) return
    previewRef.current = null
    pendingSeekRef.current = null
    setPreviewTime(null)
  }, [duration])

  useEffect(() => () => {
    if (commitTimerRef.current != null) window.clearTimeout(commitTimerRef.current)
  }, [])

  function commitPreview(): void {
    const nextTime = previewRef.current
    if (nextTime == null) return
    previewRef.current = null
    pendingSeekRef.current = nextTime
    /* 保留目标预览值，直到 audio 的真实 currentTime 到达，避免闪回旧位置。 */
    setPreviewTime(nextTime)
    onSeek(nextTime)
  }

  function scheduleCommit(): void {
    /* 某些 Chromium 版本会在 pointerup 之后才派发 range 的最后一次 change。 */
    if (commitTimerRef.current != null) window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null
      commitPreview()
    }, 0)
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2 text-sm font-mono tabular-nums text-neutral-500">
      <span className="w-14 shrink-0 whitespace-nowrap text-right">{formatTime(displayedTime)}</span>
      <input
        className="player-progress min-w-0 flex-1"
        style={{ '--progress': `${progressPercent}%` } as CSSProperties}
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={displayedTime}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onChange={(event) => {
          const nextTime = Number(event.target.value)
          pendingSeekRef.current = null
          previewRef.current = nextTime
          setPreviewTime(nextTime)
        }}
        onPointerUp={scheduleCommit}
        onPointerCancel={commitPreview}
        onKeyUp={commitPreview}
        onBlur={commitPreview}
        aria-label="播放进度"
      />
      <span className="w-14 shrink-0 whitespace-nowrap">{formatTime(duration)}</span>
      {trailing}
    </div>
  )
}
