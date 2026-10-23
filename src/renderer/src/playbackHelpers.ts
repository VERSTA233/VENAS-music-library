import { useEffect, useRef, useState } from 'react'

/* 播放器各布局共用的时间显示格式。 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

/*
 * 音频时间更新之间，进度条使用这个显示层做帧间插值；isPlaying 必须代表时钟实际推进，
 * 不能仅使用播放意图，否则文件尚在解码时就会提前计时。
 * 但不改写 store 中的真实时间，避免影响歌词高亮、会话保存和精确 seek。
 */
export function useSmoothPlaybackTime(currentTime: number, isPlaying: boolean, duration: number): number {
  const [displayTime, setDisplayTime] = useState(currentTime)
  const targetRef = useRef(currentTime)
  const anchorRef = useRef({ time: currentTime, timestamp: 0 })

  useEffect(() => {
    const nextTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
    targetRef.current = nextTime
    anchorRef.current = { time: nextTime, timestamp: performance.now() }
    setDisplayTime(nextTime)
  }, [currentTime])

  useEffect(() => {
    /*
     * 播放状态变化时必须重新建立时间锚点。否则暂停期间 requestAnimationFrame 虽然停止，
     * 旧 timestamp 仍会保留；恢复播放的第一帧会把整段暂停时长误算为播放时长。
     */
    const anchorTime = targetRef.current
    anchorRef.current = { time: anchorTime, timestamp: performance.now() }
    setDisplayTime(anchorTime)
    if (!isPlaying) return
    let frame = 0
    const tick = (timestamp: number): void => {
      const elapsed = Math.max(0, (timestamp - anchorRef.current.timestamp) / 1000)
      const nextTime = Math.min(duration > 0 ? duration : Number.POSITIVE_INFINITY, anchorRef.current.time + elapsed)
      setDisplayTime(nextTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [duration, isPlaying])

  return displayTime
}
