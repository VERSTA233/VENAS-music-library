import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ArtistRow } from '../../../shared/types'

interface LabelPickerProps {
  values: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
}

/* 多厂牌选择器：每个值独立匹配 type='Label'，Tab/Enter 接受首个搜索结果。 */
export default function LabelPicker({ values, onChange, disabled = false }: LabelPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ArtistRow[]>([])
  const [open, setOpen] = useState(false)
  const [matchStates, setMatchStates] = useState<Record<string, boolean>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    Promise.all(values.map(async (name) => [name.toLocaleLowerCase(), await window.api.artists.matchLabelExact(name)] as const))
      .then((entries) => {
        if (!cancelled) setMatchStates(Object.fromEntries(entries))
      })
    return () => {
      cancelled = true
    }
  }, [values])

  useEffect(() => {
    const requestId = ++requestRef.current
    const nextQuery = query.trim()
    if (!nextQuery) {
      setSuggestions([])
      setOpen(false)
      return
    }
    window.api.artists.searchLabels(nextQuery).then((results) => {
      if (requestId !== requestRef.current) return
      setSuggestions(results)
    }).catch(() => {
      if (requestId === requestRef.current) setSuggestions([])
    })
  }, [query])

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  function addLabel(source: string): void {
    const label = source.trim()
    if (!label) return
    if (!values.some((value) => value.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      onChange([...values, label])
    }
    setQuery('')
    setOpen(false)
  }

  function removeLabel(index: number): void {
    onChange(values.filter((_, valueIndex) => valueIndex !== index))
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {values.map((label, index) => (
          <span key={`${label}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-xs text-neutral-200">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${matchStates[label.toLocaleLowerCase()] ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="truncate">{label}</span>
            <button type="button" onClick={() => removeLabel(index)} disabled={disabled} className="shrink-0 text-neutral-500 transition hover:text-white disabled:opacity-30" title={`移除厂牌 ${label}`} aria-label={`移除厂牌 ${label}`}><X size={12} /></button>
          </span>
        ))}
        <input
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
          onBlur={() => addLabel(query)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addLabel(suggestions[0]?.name ?? query)
            } else if (event.key === 'Tab' && suggestions[0]) {
              event.preventDefault()
              addLabel(suggestions[0].name)
            } else if (event.key === 'Backspace' && !query && values.length > 0) {
              removeLabel(values.length - 1)
            }
          }}
          placeholder={values.length === 0 ? '搜索或输入厂牌' : '添加厂牌'}
          className="min-w-32 flex-1 border-b border-transparent bg-transparent py-1 text-sm text-neutral-100 outline-none transition focus:border-white/30 disabled:opacity-40"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-white/10 bg-neutral-900 shadow-lg">
          {suggestions.map((label) => (
            <button
              key={label.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addLabel(label.name)}
              className="block w-full truncate px-3 py-2 text-left text-sm text-neutral-200 transition hover:bg-white/10 hover:text-white"
            >
              {label.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
