import { ArrowDown, ArrowUp, Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SortDirection } from '../../../shared/types'

export interface SortOption<T extends string> {
  value: T
  label: string
}

interface SortMenuProps<T extends string> {
  value: T
  options: SortOption<T>[]
  direction: SortDirection
  onChange: (value: T) => void
  onDirectionChange: (direction: SortDirection) => void
  ariaLabel: string
  directionLabel: string
}

/* 统一的暗色排序菜单：使用应用内菜单替代原生 select，避免平台弹出层产生突兀的蓝色样式。 */
export default function SortMenu<T extends string>({
  value,
  options,
  direction,
  onChange,
  onDirectionChange,
  ariaLabel,
  directionLabel
}: SortMenuProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex h-8 shrink-0 items-center rounded-lg border border-white/[0.1] bg-white/[0.06] text-neutral-300 shadow-sm transition hover:border-white/[0.16] hover:bg-white/[0.1]">
      <button
        type="button"
        onClick={() => onDirectionChange(direction === 'asc' ? 'desc' : 'asc')}
        className="flex h-full w-8 items-center justify-center rounded-l-lg border-r border-white/[0.08] text-neutral-400 transition hover:bg-white/[0.08] hover:text-white active:scale-95"
        title={`${directionLabel}${direction === 'asc' ? '升序' : '降序'}`}
        aria-label={`${directionLabel}${direction === 'asc' ? '升序' : '降序'}`}
        aria-pressed={direction === 'asc'}
      >
        {direction === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-full items-center gap-1.5 rounded-r-lg px-2 text-xs font-medium transition hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{selected?.label}</span>
        <ChevronDown size={14} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+0.35rem)] z-40 min-w-full overflow-hidden rounded-xl border border-white/[0.14] bg-menu/98 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${option.value === value ? 'bg-white/[0.14] text-white' : 'text-neutral-300 hover:bg-white/[0.08] hover:text-white'}`}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">{option.value === value && <Check size={15} />}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
