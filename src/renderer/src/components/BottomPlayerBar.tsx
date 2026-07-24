import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '../stores/playerStore'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/* 底部播放条：播放/暂停/上一首/下一首、可拖拽进度条，播放超过 60% 或播放完成时打 last_heard_date 钩子 */
export default function BottomPlayerBar(): React.JSX.Element | null {
  const { queue, currentIndex, isPlaying, togglePlay, playNext, playPrev, setPlaying } = usePlayerStore()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const touchedRef = useRef(false)
  /* 拖拽进度条期间：只更新滑块位置的显示值，不触碰 audio.currentTime，避免拖动过程中不断打断播放；
     松手（或键盘方向键单次调整）时才真正 seek */
  const seekingRef = useRef(false)

  const currentTrack = currentIndex !== null ? queue[currentIndex] : null

  useEffect(() => {
    touchedRef.current = false
    setCurrentTime(0)
  }, [currentTrack])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.play().catch(() => setPlaying(false))
    } else {
      audio.pause()
    }
  }, [isPlaying, currentTrack, setPlaying])

  function handleTimeUpdate(): void {
    const audio = audioRef.current
    if (!audio) return
    // 拖拽过程中滑块显示值由用户手动控制，不能被这里持续覆盖，否则拖动会被"弹回"当前播放位置
    if (!seekingRef.current) setCurrentTime(audio.currentTime)
    if (
      !touchedRef.current &&
      currentTrack?.songId != null &&
      audio.duration > 0 &&
      audio.currentTime / audio.duration >= 0.6
    ) {
      touchedRef.current = true
      window.api.playback.touchLastHeard(currentTrack.songId)
    }
  }

  function handleEnded(): void {
    if (currentTrack?.songId != null && !touchedRef.current) {
      touchedRef.current = true
      window.api.playback.touchLastHeard(currentTrack.songId)
    }
    playNext()
  }

  /* 拖动过程中每次 onChange 只更新显示用的 currentTime，不动 audio.currentTime，播放不受影响 */
  function handleSeekPreview(e: React.ChangeEvent<HTMLInputElement>): void {
    seekingRef.current = true
    setCurrentTime(Number(e.target.value))
  }

  /* 松手（mouse/touch/pointer up）或键盘操作结束时才真正 seek 到滑块当前指向的位置 */
  function commitSeek(): void {
    if (!seekingRef.current) return
    seekingRef.current = false
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = currentTime
  }

  if (!currentTrack) return null

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-t border-white/10 bg-neutral-950">
      <audio
        ref={audioRef}
        src={currentTrack.mediaUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={handleEnded}
        autoPlay={isPlaying}
      />

      <div className="w-40 min-w-0">
        <div className="truncate text-sm">{currentTrack.title}</div>
        <div className="truncate text-xs text-neutral-500">{currentTrack.artistNames}</div>
      </div>

      <button onClick={playPrev} disabled={currentIndex === 0} className="text-neutral-400 hover:text-white disabled:opacity-30">
        ⏮
      </button>
      <button onClick={togglePlay} className="text-white text-lg">
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button
        onClick={playNext}
        disabled={currentIndex === null || currentIndex + 1 >= queue.length}
        className="text-neutral-400 hover:text-white disabled:opacity-30"
      >
        ⏭
      </button>

      <span className="text-xs text-neutral-500 w-10 text-right">{formatTime(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={currentTime}
        onChange={handleSeekPreview}
        onMouseUp={commitSeek}
        onTouchEnd={commitSeek}
        onKeyUp={commitSeek}
        className="flex-1 accent-white"
      />
      <span className="text-xs text-neutral-500 w-10">{formatTime(duration)}</span>
    </div>
  )
}
