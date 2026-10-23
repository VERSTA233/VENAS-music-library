import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

interface LyricLine {
  time: number
  text: string
}

function parseLyrics(lyric: string): LyricLine[] {
  const result: LyricLine[] = []
  for (const rawLine of lyric.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)]
    const text = rawLine.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim()
    for (const timestamp of timestamps) {
      const fraction = timestamp[3] ? Number(`0.${timestamp[3]}`) : 0
      result.push({ time: Number(timestamp[1]) * 60 + Number(timestamp[2]) + fraction, text })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

interface SyncedLyricsProps {
  lyric: string | null
  currentTime: number
  isPlaying: boolean
  onSeek: (time: number) => void
}

type LyricFollowMode = 'following' | 'browsing' | 'paused-browsing'

interface LyricViewState {
  mode: LyricFollowMode
}

type LyricViewEvent =
  | { type: 'browse' }
  | { type: 'pause-return' }
  | { type: 'follow' }
  | { type: 'reset' }

/* 歌词视窗只存在三种稳定状态：自动跟随、人工浏览、暂停时等待恢复。 */
function lyricViewReducer(state: LyricViewState, event: LyricViewEvent): LyricViewState {
  switch (event.type) {
    case 'browse':
      return state.mode === 'browsing' ? state : { ...state, mode: 'browsing' }
    case 'pause-return':
      return { ...state, mode: 'paused-browsing' }
    case 'follow':
    case 'reset':
      return { mode: 'following' }
  }
}

export default function SyncedLyrics({ lyric, currentTime, isPlaying, onSeek }: SyncedLyricsProps): React.JSX.Element {
  const lines = useMemo(() => (lyric ? parseLyrics(lyric) : []), [lyric])
  const activeIndex = lines.reduce((active, line, index) => (line.time <= currentTime ? index : active), -1)
  const focusIndex = activeIndex >= 0 ? activeIndex : 0
  const lyricsRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])
  const focusIndexRef = useRef(focusIndex)
  const activeIndexRef = useRef(activeIndex)
  const isPlayingRef = useRef(isPlaying)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [viewState, dispatchViewEvent] = useReducer(lyricViewReducer, { mode: 'following' })

  focusIndexRef.current = focusIndex
  activeIndexRef.current = activeIndex
  isPlayingRef.current = isPlaying

  const centerFocusedLine = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const container = lyricsRef.current
    const focusedLine = lineRefs.current[focusIndexRef.current]
    if (!container || !focusedLine) return
    const containerRect = container.getBoundingClientRect()
    const focusedRect = focusedLine.getBoundingClientRect()
    const targetOffset = activeIndexRef.current < 0 ? container.clientHeight * 0.62 : container.clientHeight / 2
    container.scrollTo({
      top: container.scrollTop + focusedRect.top - containerRect.top + focusedRect.height / 2 - targetOffset,
      behavior
    })
  }, [])

  const resumeFollowing = useCallback((): void => {
    dispatchViewEvent({ type: 'follow' })
    centerFocusedLine()
  }, [centerFocusedLine])

  const scheduleReturn = useCallback((): void => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      if (!isPlayingRef.current) {
        dispatchViewEvent({ type: 'pause-return' })
        return
      }
      resumeFollowing()
    }, 4000)
  }, [resumeFollowing])

  const pauseFollowing = useCallback((): void => {
    dispatchViewEvent({ type: 'browse' })
    scheduleReturn()
  }, [scheduleReturn])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    pauseFollowing()
    const container = event.currentTarget
    if (container.scrollHeight <= container.clientHeight) return
    event.preventDefault()
    const delta = event.deltaMode === 1
      ? event.deltaY * 20
      : event.deltaMode === 2
      ? event.deltaY * container.clientHeight
      : event.deltaY
    container.scrollBy({ top: delta, behavior: 'auto' })
  }, [pauseFollowing])

  function jumpToLine(index: number): void {
    const line = lines[index]
    if (!line) return
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    dispatchViewEvent({ type: 'follow' })
    onSeek(line.time)
  }

  useEffect(() => {
    dispatchViewEvent({ type: 'reset' })
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
  }, [lyric])

  useEffect(() => {
    if (viewState.mode === 'following') centerFocusedLine()
  }, [centerFocusedLine, focusIndex, viewState.mode])

  useEffect(() => {
    if (isPlaying && viewState.mode === 'paused-browsing') scheduleReturn()
  }, [isPlaying, scheduleReturn, viewState.mode])

  useEffect(() => () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
  }, [])

  if (!lyric?.trim()) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-400">暂无歌词</div>
  }

  if (lines.length === 0) {
    return (
      <div className="relative h-full overflow-hidden">
        <div
          onWheel={handleWheel}
          onPointerDown={pauseFollowing}
          onTouchStart={pauseFollowing}
          className="h-full overflow-y-auto overscroll-contain whitespace-pre-wrap px-6 py-16 text-center text-lg leading-9 text-neutral-300 [scrollbar-width:none]"
        >
          {lyric}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-player via-player/85 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-player via-player/85 to-transparent" />
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={lyricsRef}
        onWheel={handleWheel}
        onPointerDown={pauseFollowing}
        onTouchStart={pauseFollowing}
        className="h-full overflow-y-auto overscroll-contain px-6 [scrollbar-width:none]"
      >
        <div className="before:block before:h-[40vh] after:block after:h-[40vh]">
          {lines.map((line, index) => (
            <p
              key={`${line.time}-${index}`}
              ref={(element) => { lineRefs.current[index] = element }}
              onMouseDown={(event) => {
                if (event.detail !== 2) return
                event.preventDefault()
                jumpToLine(index)
              }}
              onDoubleClick={(event) => {
                event.preventDefault()
              }}
              title="双击跳转到此句"
              className={`cursor-pointer select-text py-2 text-center text-xl font-medium leading-9 transition ${index === activeIndex ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'}`}
            >
              {line.text || '♪'}
            </p>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-player via-player/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-player via-player/85 to-transparent" />
    </div>
  )
}
