import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, ListMusic, MoreHorizontal } from 'lucide-react'
import type { AppendEntry, SongDetail } from '../../../shared/types'
import type { NavTarget } from '../stores/navStore'
import { usePlayerStore } from '../stores/playerStore'
import PlaybackCover from './PlaybackCover'
import SyncedLyrics from './SyncedLyrics'
import SongEditModal from './SongEditModal'
import IngestModal from './IngestModal'
import PlaybackControls from './PlaybackControls'
import QueuePanel from './QueuePanel'
import PlaybackProgress from './PlaybackProgress'

interface FullPlayerProps {
  open: boolean
  onClose: () => void
  onNavigate: (target: Extract<NavTarget, { view: 'artist' | 'album' }>) => void
}

/* 沉浸式播放层从底部进入并沿同一路径收起，避免播放中误触拖拽。 */
export default function FullPlayer({ open, onClose, onNavigate }: FullPlayerProps): React.JSX.Element {
  const { queue, currentIndex, isPlaying, isAdvancing, togglePlay, playNext, playPrev, playAt, playbackMode, setPlaybackMode, currentTime, duration, requestSeek } = usePlayerStore()
  const currentTrack = currentIndex == null ? null : queue[currentIndex] ?? null
  const [detail, setDetail] = useState<SongDetail | null>(null)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [editingSongId, setEditingSongId] = useState<number | null>(null)
  const [ingestingEntry, setIngestingEntry] = useState<AppendEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    if (currentTrack?.songId == null) {
      setDetail(null)
      return
    }
    window.api.songs.detail(currentTrack.songId).then((song) => {
      if (!cancelled) setDetail(song)
    })
    return () => {
      cancelled = true
    }
  }, [currentTrack?.key, currentTrack?.songId])

  const lyric = detail?.lyric ?? currentTrack?.appendEntry?.lyric ?? null
  const appendAlbum = currentTrack?.appendEntry?.album
  const artistText = detail?.artists.map((artist) => artist.name).join(' / ') ?? currentTrack?.artistNames ?? ''

  function closeAndNavigate(target: { view: 'artist'; id: number; isLabel: boolean } | { view: 'album'; id: number }): void {
    onNavigate(target)
  }

  function openTrackDetail(): void {
    if (currentTrack?.songId != null) setEditingSongId(currentTrack.songId)
    else if (currentTrack?.appendEntry) setIngestingEntry(currentTrack.appendEntry)
  }

  return (
    <AnimatePresence>
      {open && currentTrack && (
        <motion.section
          className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-player text-white"
          initial={{ y: '100%', opacity: 0.7 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0.7 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.42 }}
        >
          <header className="window-drag-region relative z-10 flex h-24 shrink-0 items-center px-5">
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-300 transition active:scale-95 hover:bg-white/10 hover:text-white"
              title="收起播放界面"
              aria-label="收起播放界面"
            >
              <ChevronDown size={25} strokeWidth={1.8} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-5 md:overflow-hidden md:px-16 lg:px-24">
            <div className="grid w-full grid-cols-1 content-start gap-y-5 md:mx-auto md:max-w-[880px] md:grid-cols-2 md:gap-x-10 md:gap-y-0">
              <div className="order-1 min-w-0 md:-translate-x-5">
                <PlaybackCover track={currentTrack} className="aspect-square w-full rounded-xl object-cover shadow-2xl shadow-black/40" />
                <div className="flex min-w-0 flex-col gap-1 pt-5">
                  <TruncatedText text={currentTrack.title} lines={2} revealDelay={1500} className="text-2xl font-semibold leading-tight" />
                  <div className="relative top-[2px]">
                    {detail ? (
                      <HoverMarqueeArtistLinks artists={detail.artists} fullText={artistText} onNavigate={closeAndNavigate} />
                    ) : (
                      <HoverMarqueeText text={artistText} className="text-base leading-6 text-neutral-400" />
                    )}
                  </div>
                  {detail?.album ? (
                    <button
                      className="w-full min-w-0 cursor-pointer text-left text-neutral-500 outline-none transition-colors duration-200 ease-out hover:text-neutral-200 focus-visible:text-white active:text-white"
                      onClick={() => closeAndNavigate({ view: 'album', id: detail.album!.id })}
                    >
                      <HoverMarqueeText
                        text={detail.album.title}
                        className="text-sm leading-6"
                      />
                    </button>
                  ) : appendAlbum ? (
                    <HoverMarqueeText text={appendAlbum} className="text-sm leading-6 text-neutral-500" />
                  ) : null}
                </div>
              </div>
              <aside className="relative order-2 min-h-[280px] overflow-hidden md:min-h-0 md:translate-x-5">
                <div className="absolute inset-0">
                  <SyncedLyrics lyric={lyric} currentTime={currentTime} isPlaying={isPlaying} onSeek={requestSeek} />
                </div>
              </aside>
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/[0.07] bg-black/15 px-5 py-4 backdrop-blur-xl md:px-10">
            <div className="mx-auto flex max-w-5xl flex-col items-center gap-2">
              <div className="flex items-center gap-5 sm:gap-6">
                <PlaybackControls variant="full" isPlaying={isPlaying} playbackMode={playbackMode} onToggleMode={() => setPlaybackMode(playbackMode === 'shuffle' ? 'sequential' : 'shuffle')} onPrevious={playPrev} onTogglePlay={togglePlay} onNext={playNext} />
                <button type="button" onClick={() => setPlaylistOpen((value) => !value)} className={`flex h-12 w-12 items-center justify-center rounded-full transition active:scale-95 ${playlistOpen ? 'bg-white text-black' : 'text-neutral-300 hover:bg-white/10 hover:text-white'}`} title="当前播放列表" aria-label="当前播放列表"><ListMusic size={21} /></button>
              </div>
              <PlaybackProgress
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying && isAdvancing}
                onSeek={requestSeek}
                trailing={<button type="button" onClick={openTrackDetail} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-400 transition active:scale-95 hover:bg-white/10 hover:text-white" title="歌曲信息 / 添加到音乐库" aria-label="歌曲信息 / 添加到音乐库"><MoreHorizontal size={20} /></button>}
              />
            </div>
          </footer>

          <QueuePanel open={playlistOpen} variant="full" queue={queue} currentIndex={currentIndex} onPlayAt={playAt} onClose={() => setPlaylistOpen(false)} />

          {editingSongId != null && <SongEditModal songId={editingSongId} onClose={() => setEditingSongId(null)} onSaved={() => setEditingSongId(null)} />}
          {ingestingEntry && <IngestModal entry={ingestingEntry} onClose={() => setIngestingEntry(null)} onIngested={() => setIngestingEntry(null)} />}
        </motion.section>
      )}
    </AnimatePresence>
  )
}

type ArtistLink = SongDetail['artists'][number]

function HoverMarqueeArtistLinks({
  artists,
  fullText,
  onNavigate
}: {
  artists: ArtistLink[]
  fullText: string
  onNavigate: FullPlayerProps['onNavigate']
}): React.JSX.Element {
  const { contentRef, viewportRef, overflowing, phase, offset, duration, onPointerEnter, onPointerLeave } = useHoverMarquee(fullText)
  const showEllipsis = overflowing && phase === 'idle'

  return (
    <div className="relative h-6 min-w-0 text-base leading-6 text-neutral-400" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <span ref={viewportRef} className="block overflow-hidden">
        <span
          ref={contentRef}
          className="block w-max whitespace-nowrap will-change-transform"
          style={{
            transform: phase === 'forward' ? `translateX(-${offset}px)` : 'translateX(0)',
            transition: `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
          }}
        >
        {artists.map((artist, index) => (
          <span key={`${artist.id}-${artist.order}`}>
            {index > 0 && <span className="mx-2 text-neutral-600">/</span>}
            <button
              type="button"
              className="cursor-pointer transition-colors duration-200 ease-out hover:text-white focus-visible:text-white"
              onClick={() => onNavigate({ view: 'artist', id: artist.id, isLabel: false })}
            >
              {artist.name}
            </button>
          </span>
        ))}
        </span>
      </span>
      {showEllipsis && <span className="absolute right-0 top-0 bg-player pl-0.5 text-neutral-400"> ...</span>}
    </div>
  )
}

function HoverMarqueeText({ text, className }: { text: string; className: string }): React.JSX.Element {
  const { contentRef, viewportRef, overflowing, phase, offset, duration, onPointerEnter, onPointerLeave } = useHoverMarquee(text)
  const showEllipsis = overflowing && phase === 'idle'

  return (
    <span className="relative block min-w-0" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <span ref={viewportRef} className="block overflow-hidden">
        <span
          ref={contentRef}
          className={`block w-max whitespace-nowrap will-change-transform ${className}`}
          style={{
            transform: phase === 'forward' ? `translateX(-${offset}px)` : 'translateX(0)',
            transition: `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
          }}
        >
          {text}
        </span>
      </span>
      {showEllipsis && <span className={`absolute right-0 top-0 bg-player pl-0.5 ${className}`}> ...</span>}
    </span>
  )
}

/* 通过实际排版高度裁切，避免浏览器原生省略号紧贴文本；保留完整内容给鼠标悬浮提示。 */
function TruncatedText({
  text,
  lines,
  className,
  revealDelay
}: {
  text: string
  lines: 1 | 2
  className: string
  revealDelay?: number
}): React.JSX.Element {
  const visibleRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const revealTimerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const visible = visibleRef.current
    const measure = measureRef.current
    if (!visible || !measure) return

    let frame = 0
    const update = (): void => {
      frame = requestAnimationFrame(() => {
        const lineHeight = Number.parseFloat(getComputedStyle(visible).lineHeight)
        if (!Number.isFinite(lineHeight) || visible.clientWidth === 0) return

        measure.style.width = `${visible.clientWidth}px`
        measure.textContent = text
        const maxHeight = lineHeight * lines + 0.5
        setTruncated(measure.scrollHeight > maxHeight)
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(visible)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [lines, text])

  useEffect(() => () => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current)
  }, [])

  function handlePointerEnter(): void {
    if (!truncated || !revealDelay || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    revealTimerRef.current = window.setTimeout(() => setRevealed(true), revealDelay)
  }

  function handlePointerLeave(): void {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current)
    revealTimerRef.current = null
    setRevealed(false)
  }

  return (
    <span className="relative block w-full min-w-0" onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <span
        ref={visibleRef}
        className={`block overflow-hidden ${lines === 2 ? 'line-clamp-2' : 'truncate'} ${className}`}
        style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines }}
        title={truncated && !revealDelay ? text : undefined}
      >
        {text}
      </span>
      <span ref={measureRef} aria-hidden="true" className={`pointer-events-none absolute left-0 top-0 -z-10 block invisible ${className}`} />
      {revealed && (
        <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-max max-w-[min(32rem,calc(100vw-3rem))] rounded-lg bg-tooltip/95 px-3 py-2 text-sm font-medium leading-5 text-white shadow-xl shadow-black/40 backdrop-blur-xl">
          {text}
        </span>
      )}
    </span>
  )
}

type MarqueePhase = 'idle' | 'forward' | 'return'

function useHoverMarquee(content: string): {
  contentRef: React.RefObject<HTMLSpanElement | null>
  viewportRef: React.RefObject<HTMLSpanElement | null>
  overflowing: boolean
  phase: MarqueePhase
  offset: number
  duration: number
  onPointerEnter: () => void
  onPointerLeave: () => void
} {
  const contentRef = useRef<HTMLSpanElement>(null)
  const viewportRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [offset, setOffset] = useState(0)
  const [phase, setPhase] = useState<MarqueePhase>('idle')
  const timersRef = useRef<number[]>([])
  const duration = Math.min(4800, Math.max(1400, offset * 16))

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const contentElement = contentRef.current
    if (!viewport || !contentElement) return
    const update = (): void => {
      const nextOffset = Math.max(0, contentElement.scrollWidth - viewport.clientWidth)
      setOffset(nextOffset)
      setOverflowing(nextOffset > 1)
      if (nextOffset <= 1) setPhase('idle')
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    observer.observe(contentElement)
    return () => observer.disconnect()
  }, [content])

  function clearTimers(): void {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
  }

  useEffect(() => () => clearTimers(), [])

  function onPointerEnter(): void {
    if (!overflowing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    clearTimers()
    timersRef.current.push(
      window.setTimeout(() => {
        setPhase('forward')
        timersRef.current.push(window.setTimeout(() => setPhase('return'), duration + 750))
        timersRef.current.push(window.setTimeout(() => setPhase('idle'), duration * 2 + 750))
      }, 1500)
    )
  }

  function onPointerLeave(): void {
    clearTimers()
    setPhase('idle')
  }

  return { contentRef, viewportRef, overflowing, phase, offset, duration, onPointerEnter, onPointerLeave }
}
