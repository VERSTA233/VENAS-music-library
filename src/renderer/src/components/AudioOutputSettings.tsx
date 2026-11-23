import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AudioOutputSettings as AudioOutputState, MacAudioBackend } from '../../../shared/types'
import { useDismissibleLayer } from '../hooks/useDismissibleLayer'

const options: { value: MacAudioBackend; label: string }[] = [
  { value: 'avfoundation', label: 'AVFoundation' },
  { value: 'auhal', label: 'AUHAL / Core Audio' }
]

function labelFor(backend: MacAudioBackend): string {
  return options.find((option) => option.value === backend)!.label
}

export default function AudioOutputSettings(): React.JSX.Element | null {
  const [state, setState] = useState<AudioOutputState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void window.api.playback.getAudioOutput().then((value) => {
      if (active) setState(value)
    }).catch(() => {
      if (active) setError('无法读取音频输出设置，请稍后重试。')
    })
    return () => { active = false }
  }, [])

  useDismissibleLayer(open, [menuRef], () => setOpen(false), true)

  async function changeBackend(backend: MacAudioBackend): Promise<void> {
    if (!state || saving || backend === state.selectedBackend) return
    setSaving(true)
    setError(null)
    try {
      setState(await window.api.playback.setAudioOutput(backend))
    } catch {
      setError('音频输出设置保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  if (!state?.supported) return error ? <p role="alert" className="px-5 pb-4 text-xs text-red-400">{error}</p> : null
  const pending = state.activeBackend !== state.selectedBackend

  return (
    <div className="min-w-0">
      <div className="mx-5 border-t border-white/[0.08]" />
      <div className="flex items-center justify-between gap-6 px-5 py-4">
        <span className="text-sm text-neutral-200">音频输出</span>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="音频输出"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={saving}
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => { if (event.code === 'Space') event.stopPropagation() }}
            className="flex h-8 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 text-xs text-neutral-300 transition hover:border-white/[0.16] hover:bg-white/[0.1] disabled:opacity-50"
          >
            <span>{labelFor(state.selectedBackend)}</span>
            <ChevronDown size={14} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div role="menu" aria-label="音频输出" className="absolute right-0 top-[calc(100%+0.35rem)] z-40 min-w-full overflow-hidden rounded-xl border border-white/[0.14] bg-menu/98 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  value={option.value}
                  aria-checked={state.selectedBackend === option.value}
                  onClick={() => { setOpen(false); void changeBackend(option.value) }}
                  onKeyDown={(event) => { if (event.code === 'Space') event.stopPropagation() }}
                  className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${state.selectedBackend === option.value ? 'bg-white/[0.14] text-white' : 'text-neutral-300 hover:bg-white/[0.08] hover:text-white'}`}
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">{state.selectedBackend === option.value && <Check size={15} />}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {pending && <p role="status" className="px-5 pb-4 text-xs leading-5 text-amber-200/80">{state.launchOverride ? '启动参数覆盖了后端设置，请移除相关参数并重启应用。' : '已保存，重启应用后生效。'}</p>}
      {error && <p role="alert" className="px-5 pb-4 text-xs text-red-400">{error}</p>}
    </div>
  )
}
