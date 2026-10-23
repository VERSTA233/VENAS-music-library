import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import type { Ref } from 'react'
import type { PlayerTrack } from '../stores/playerStore'

interface QueuePanelProps {
  open: boolean
  variant: 'bottom' | 'full'
  queue: PlayerTrack[]
  currentIndex: number | null
  onPlayAt: (index: number) => void
  onClose: () => void
  panelRef?: Ref<HTMLDivElement>
}

/* 两种呈现方式复用一份队列数据和选择逻辑，底部为弹出层、全屏为侧舱。 */
export default function QueuePanel({ open, variant, queue, currentIndex, onPlayAt, onClose, panelRef }: QueuePanelProps): React.JSX.Element | null {
  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {queue.map((track, index) => (
        <button type="button" key={track.key} onClick={() => { onPlayAt(index); onClose() }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${index === currentIndex ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'}`}>
          <span className={`w-5 text-center text-xs tabular-nums ${index === currentIndex ? 'text-white' : 'text-neutral-600'}`}>{index === currentIndex ? '♪' : index + 1}</span>
          <span className="min-w-0 flex-1"><span className={`block truncate text-sm ${index === currentIndex ? 'text-white' : 'text-neutral-300'}`}>{track.title}</span><span className="block truncate text-xs text-neutral-500">{track.artistNames}</span></span>
        </button>
      ))}
    </div>
  )

  if (variant === 'bottom') {
    if (!open) return null
    return (
      <div ref={panelRef} className="absolute bottom-[84px] right-3 z-[70] flex max-h-[min(520px,calc(100vh-180px))] w-80 flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3"><h2 className="text-sm font-semibold text-white">当前播放列表</h2><button type="button" onClick={onClose} className="library-icon-button" title="关闭播放列表" aria-label="关闭播放列表"><X size={17} /></button></div>
        {list}
      </div>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button type="button" className="absolute inset-0 z-10 cursor-default" aria-label="关闭播放列表" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-white/10 bg-queue/95 shadow-2xl backdrop-blur-2xl" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }} transition={{ type: 'spring', bounce: 0, duration: 0.32 }} aria-label="当前播放列表">
            <div className="flex items-center justify-between px-5 py-5"><h2 className="text-base font-semibold">当前播放列表</h2><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white" title="关闭播放列表" aria-label="关闭播放列表"><X size={19} /></button></div>
            {list}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
