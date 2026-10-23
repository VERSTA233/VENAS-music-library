import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'

export default function VolumeControl(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const volume = usePlayerStore((state) => state.volume)
  const muted = usePlayerStore((state) => state.muted)
  const ready = usePlayerStore((state) => state.gaplessReady)
  const silent = muted || volume === 0
  const percent = muted ? 0 : Math.round(volume * 100)
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  return (
    <div ref={containerRef} className="relative flex items-center" role="group" aria-label="音量控制"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}
      onKeyDown={(event) => {
        if (event.code === 'Space') event.stopPropagation()
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}>
      <button ref={triggerRef} type="button" disabled={!ready} onClick={() => setOpen((value) => !value)}
        title={`音量 ${percent}%`} aria-label="调整音量" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog"
        className={`rounded p-2 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-40 ${open ? 'text-white' : 'text-neutral-500'}`}>
        <Icon size={19} />
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="调整音量" className="absolute bottom-[calc(100%+20px)] left-1/2 z-[100] w-52 -translate-x-1/2 rounded-xl border border-white/10 bg-panel/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-2xl">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => usePlayerStore.getState().toggleMute()}
              title={silent ? '取消静音' : '静音'} aria-label={silent ? '取消静音' : '静音'} aria-pressed={silent}
              className="rounded p-1 text-neutral-400 transition hover:bg-white/10 hover:text-white">
              <Icon size={17} />
            </button>
            <input autoFocus type="range" min={0} max={100} step={1} value={percent} disabled={!ready}
              onChange={(event) => usePlayerStore.getState().setVolume(Number(event.target.value) / 100)}
              aria-label="音量" aria-valuetext={`${percent}%`} title={`音量 ${percent}%`}
              className="player-progress min-w-0 flex-1 disabled:opacity-40"
              style={{ '--progress': `${percent}%` } as CSSProperties} />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-400">{percent}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
