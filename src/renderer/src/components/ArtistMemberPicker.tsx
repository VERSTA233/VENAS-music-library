import { UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ArtistRow } from '../../../shared/types'

interface ArtistMemberPickerProps {
  ownerId: number
  members: ArtistRow[]
  onChange: (members: ArtistRow[]) => void
  disabled?: boolean
}

/* Group/Label 成员只关联数据库中已有的非厂牌艺术家，不在这里隐式创建新记录。 */
export default function ArtistMemberPicker({
  ownerId,
  members,
  onChange,
  disabled = false
}: ArtistMemberPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ArtistRow[]>([])
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestRef.current
    const source = query.trim()
    if (!source) {
      setSuggestions([])
      setOpen(false)
      return
    }
    void window.api.artists.search(source).then((results) => {
      if (requestId !== requestRef.current) return
      const selectedIds = new Set(members.map((member) => member.id))
      setSuggestions(results.filter((candidate) =>
        candidate.id !== ownerId && candidate.type !== 'Label' && !selectedIds.has(candidate.id)
      ))
      setOpen(true)
    }).catch(() => {
      if (requestId === requestRef.current) setSuggestions([])
    })
  }, [members, ownerId, query])

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  function addMember(member: ArtistRow): void {
    if (member.id === ownerId || members.some((current) => current.id === member.id)) return
    onChange([...members, member])
    setQuery('')
    setSuggestions([])
    setOpen(false)
  }

  function removeMember(memberId: number): void {
    onChange(members.filter((member) => member.id !== memberId))
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 transition focus-within:border-white/[0.25] focus-within:bg-white/[0.08]">
        <UserPlus size={15} className="shrink-0 text-neutral-500" />
        <input
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === 'Tab') && suggestions[0]) {
              event.preventDefault()
              addMember(suggestions[0])
            }
          }}
          placeholder="搜索已有艺术家"
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none disabled:opacity-40"
        />
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-white/[0.1] bg-neutral-900 p-1 shadow-xl shadow-black/40">
          {suggestions.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addMember(candidate)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-white/[0.08] active:scale-[0.99] active:bg-white/[0.12]"
            >
              <span className="min-w-0 truncate text-sm text-neutral-200">{candidate.name}</span>
              <span className="shrink-0 text-xs text-neutral-500">{candidate.type ?? '未设置'}</span>
            </button>
          ))}
        </div>
      )}

      {members.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {members.map((member) => (
            <span key={member.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/[0.08] py-1 pl-2 pr-1 text-xs text-neutral-200">
              <span className="max-w-52 truncate">{member.name}</span>
              <button
                type="button"
                onClick={() => removeMember(member.id)}
                disabled={disabled}
                className="rounded p-0.5 text-neutral-500 transition hover:bg-white/[0.08] hover:text-white active:scale-90 disabled:opacity-30"
                title={`移除成员 ${member.name}`}
                aria-label={`移除成员 ${member.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
