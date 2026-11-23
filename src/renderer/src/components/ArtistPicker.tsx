import { useEffect, useRef, useState } from 'react'
import type { ArtistRow, IngestArtistInput } from '../../../shared/types'
import { artistSelectionKey } from '../../../shared/artistSelection'
import { useDismissibleLayer } from '../hooks/useDismissibleLayer'

/* nameEdited 仅存在于表单：标记行内改名，不改变明确新建的选择语义。 */
export type ArtistFormEntry = IngestArtistInput & { nameEdited?: boolean }

/* 名称完全相同或以输入内容开头（忽略大小写）的已有艺术家。 */
async function findArtistNameMatches(name: string): Promise<ArtistRow[]> {
  const needle = name.trim().toLowerCase()
  if (!needle) return []
  const results = await window.api.artists.search(name.trim())
  return results.filter((artist) => artist.name.trim().toLowerCase().startsWith(needle))
}

/* 角色建议值（非数据库约束，仅作为下拉的候选提示，用户可自由输入其他角色） */
const ROLE_SUGGESTIONS = ['Primary', 'Featured', 'Composer', 'Vocalist', 'Remixer']

interface ArtistPickerProps {
  artists: ArtistFormEntry[]
  onChange: (artists: ArtistFormEntry[]) => void
  /* 专辑艺术家场景下 album_artists 表没有 role 列，编辑时不展示角色选择器（role 字段仍保留但不会被读取） */
  showRole?: boolean
  relatedArtists?: ArtistFormEntry[]
  onOpenArtist?: (artistId: number) => void
  /* 同步另一列表中同一选择的类型，避免影响同名的已有艺术家。 */
  onTypeChange?: (artist: ArtistFormEntry, type: 'Person' | 'Group' | null) => void
}

/* 类型只对待新建的艺术家可编辑；已选艺术家的资料由艺术家主页维护。 */
const TYPE_OPTIONS: { value: 'Person' | 'Group'; label: string }[] = [
  { value: 'Person', label: 'Person' },
  { value: 'Group', label: 'Group' }
]

/* 歌曲/专辑共用：回车或新增按钮创建，Tab/点击候选按 ID 选择已有艺术家。 */
export default function ArtistPicker({
  artists,
  onChange,
  showRole = true,
  relatedArtists = [],
  onOpenArtist,
  onTypeChange
}: ArtistPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ArtistRow[]>([])
  const searchRequestRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  /* 自动匹配项用精确结果判断绿灯；明确新增或行内改名的项用它判断是否与已有艺术家重名。 */
  const [matchStatus, setMatchStatus] = useState<Record<string, ArtistRow | null>>({})
  /* 新建和行内改名的候选按名称缓存；焦点进入行内输入框时显示。 */
  const [editedMatches, setEditedMatches] = useState<Record<string, ArtistRow[]>>({})
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [candidatesAbove, setCandidatesAbove] = useState(false)
  const selectedIds = artists.flatMap((a) => (a.artistId != null ? [a.artistId] : []))

  useEffect(() => {
    const names = Array.from(new Set(artists.filter((a) => a.createNew).map((a) => a.name.trim()).filter(Boolean)))
    const pending = names.filter((n) => !(n in editedMatches))
    if (pending.length === 0) return
    let cancelled = false
    void Promise.all(pending.map((n) => findArtistNameMatches(n))).then((results) => {
      if (cancelled) return
      setEditedMatches((prev) => {
        const next = { ...prev }
        pending.forEach((n, i) => {
          next[n] = results[i]
        })
        return next
      })
    }).catch(() => { /* 查询失败时不提示候选，提交前的确认仍会重新查询。 */ })
    return () => {
      cancelled = true
    }
  }, [artists, editedMatches])

  function matchesFor(artist: ArtistFormEntry): ArtistRow[] {
    if (!artist.createNew) return []
    const name = artist.name.trim()
    const exact = matchStatus[name]
    const candidates = editedMatches[name] ?? []
    /* search() 最多返回 20 项；精确同名项必须与黄灯判定保持一致，即使不在前 20 项中。 */
    return exact ? [exact, ...candidates.filter((candidate) => candidate.id !== exact.id)] : candidates
  }

  /* 精确匹配只决定状态灯颜色；明确新增仍会创建独立记录，不会自动关联同名艺术家。 */
  useEffect(() => {
    const names = Array.from(new Set(artists.filter((a) => a.artistId == null).map((a) => a.name.trim()).filter(Boolean)))
    const pending = names.filter((n) => !(n in matchStatus))
    if (pending.length === 0) return
    let cancelled = false
    void Promise.all(pending.map((n) => window.api.artists.findExact(n))).then((results) => {
      if (cancelled) return
      setMatchStatus((prev) => {
        const next = { ...prev }
        pending.forEach((n, i) => {
          next[n] = results[i]
        })
        return next
      })
    }).catch(() => { /* 查询失败时保留待匹配状态，明确新增与按 ID 选择不受影响。 */ })
    return () => {
      cancelled = true
    }
  }, [artists, matchStatus])

  useDismissibleLayer(suggestionsOpen, [rootRef], () => setSuggestionsOpen(false))

  useEffect(() => () => { searchRequestRef.current += 1 }, [])

  async function handleQueryChange(value: string): Promise<void> {
    const requestId = ++searchRequestRef.current
    setQuery(value)
    setSuggestions([])
    setSuggestionsOpen(true)
    if (!value.trim()) {
      return
    }
    try {
      const results = await window.api.artists.search(value.trim())
      if (requestId === searchRequestRef.current) setSuggestions(results)
    } catch {
      if (requestId === searchRequestRef.current) setSuggestions([])
    }
  }

  function addArtist(value: string | ArtistRow): void {
    const entry: ArtistFormEntry = typeof value === 'string'
      ? { name: value.trim(), role: 'Primary', order: artists.length, type: 'Person', createNew: true }
      : { name: value.name, role: 'Primary', order: artists.length, type: null, artistId: value.id }
    if (!entry.name) return
    if (entry.createNew) {
      const related = relatedArtists.find((artist) => artistSelectionKey(artist) === artistSelectionKey(entry))
      if (related) entry.type = related.type
    }
    if (artists.some((artist) => artistSelectionKey(artist) === artistSelectionKey(entry))) return
    const replacesAutomatic = (artist: ArtistFormEntry): boolean => artist.artistId == null && !artist.createNew
      && artist.name.trim().toLowerCase() === entry.name.toLowerCase()
    const next = artists.some(replacesAutomatic)
      ? artists.map((artist) => replacesAutomatic(artist) ? { ...entry, role: artist.role, order: artist.order } : artist)
      : [...artists, entry]
    searchRequestRef.current += 1
    onChange(next)
    setQuery('')
    setSuggestions([])
    setSuggestionsOpen(false)
  }

  function removeArtist(index: number): void {
    onChange(artists.filter((_, i) => i !== index).map((a, i) => ({ ...a, order: i })))
  }

  function updateName(index: number, name: string): void {
    onChange(artists.map((a, i) => (i === index ? { ...a, name, artistId: undefined, createNew: true, nameEdited: true, type: a.type ?? 'Person' } : a)))
  }

  /* 从行内候选中选定已有艺术家：按 ID 关联，保留角色与顺序。 */
  function pickEditedCandidate(index: number, candidate: ArtistRow): void {
    const current = artists[index]
    const sameSelection = artists.some((artist, i) => i !== index && artist.artistId === candidate.id
      && (!showRole || artist.role === current.role))
    const next = sameSelection
      ? artists.filter((_, i) => i !== index)
      : artists.map((a, i) => (i === index ? { name: candidate.name, role: a.role, order: a.order, type: null, artistId: candidate.id } : a))
    onChange(next.map((artist, order) => ({ ...artist, order })))
    setEditingIndex(null)
  }

  function updateRole(index: number, role: string): void {
    onChange(artists.map((a, i) => (i === index ? { ...a, role } : a)))
  }

  function updateType(index: number, type: 'Person' | 'Group' | null): void {
    const target = artists[index]
    if (onTypeChange) onTypeChange(target, type)
    else onChange(artists.map((a, i) => (i === index ? { ...a, type } : a)))
  }

  function moveArtist(index: number, dir: -1 | 1): void {
    const target = index + dir
    if (target < 0 || target >= artists.length) return
    const next = [...artists]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next.map((a, i) => ({ ...a, order: i })))
  }

  const availableSuggestions = suggestions.filter((candidate) => !artists.some((artist) => artist.artistId === candidate.id))

  return (
    <div className="flex flex-col gap-2">
      <div ref={rootRef} className="relative">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => setSuggestionsOpen(true)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') {
                e.preventDefault()
                addArtist(query)
              }
              if (e.key === 'Tab' && suggestionsOpen && availableSuggestions[0]) {
                e.preventDefault()
                addArtist(availableSuggestions[0])
              }
              if (e.key === 'Escape') setSuggestionsOpen(false)
            }}
            placeholder="搜索或输入艺术家"
            className="h-8 min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 text-sm text-neutral-100 outline-none focus:border-white/30"
          />
          {query.trim() && (
            <button type="button" onClick={() => addArtist(query)} title="新建独立艺术家，同名时也会创建新记录；保存信息后生效" className="shrink-0 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-white/[0.14] hover:text-white">新增</button>
          )}
        </div>
        {suggestionsOpen && availableSuggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-neutral-900 border border-white/10 rounded shadow-lg max-h-40 overflow-y-auto">
            {availableSuggestions.map((a) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addArtist(a)}
                className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-sm transition hover:bg-white/10"
              >
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="shrink-0 text-xs text-neutral-500">{[a.type, a.country, `#${a.id}`].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {artists.length > 0 && <div className="flex flex-col gap-1">
        {artists.map((a, i) => {
          const trimmed = a.name.trim()
          const exactMatch = trimmed ? matchStatus[trimmed] : undefined
          const matched = a.artistId != null ? true : a.createNew ? false : exactMatch === undefined ? undefined : exactMatch !== null
          const linkedArtistId = a.artistId ?? (!a.createNew ? exactMatch?.id : undefined)
          const candidates = matchesFor(a)
          const hasCandidates = candidates.length > 0
          const duplicate = a.createNew && exactMatch != null
          const matching = a.artistId == null && !!trimmed && exactMatch === undefined
          return (
            <div key={i} className="relative flex items-center gap-2 bg-white/5 rounded px-2 py-1">
              <button
                type="button"
                disabled={!matched || linkedArtistId == null || !onOpenArtist}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { if (linkedArtistId != null) onOpenArtist?.(linkedArtistId) }}
                aria-label={matched && onOpenArtist ? `查看艺术家 ${a.name} 的主页` : '艺术家匹配状态'}
                className="flex h-6 w-4 shrink-0 items-center justify-center rounded transition enabled:cursor-pointer enabled:hover:bg-white/10 disabled:cursor-default"
                title={matched && onOpenArtist ? `查看 ${a.name} 的艺术家主页` : undefined}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    matching ? 'bg-neutral-600' : matched ? 'bg-green-500' : duplicate ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  title={
                    matching
                      ? '匹配中...'
                      : matched
                        ? `已关联艺术家${a.artistId != null ? ` #${a.artistId}` : ''}`
                        : duplicate
                          ? `已有同名艺术家 #${exactMatch?.id}；直接保存将创建独立记录`
                          : '数据库中没有同名艺术家；保存时将新建独立记录'
                  }
                />
              </button>
              <input
                value={a.name}
                onChange={(e) => updateName(i, e.target.value)}
                onFocus={(event) => {
                  const row = event.currentTarget.parentElement!.getBoundingClientRect()
                  const scrollArea = event.currentTarget.closest('.modal-scroll')
                  const viewport = scrollArea?.getBoundingClientRect()
                  const below = (viewport?.bottom ?? window.innerHeight) - row.bottom
                  const above = row.top - (viewport?.top ?? 0)
                  setCandidatesAbove(below < 180 && above > below)
                  setEditingIndex(i)
                }}
                onBlur={() => setEditingIndex((current) => (current === i ? null : current))}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Tab' && editingIndex === i && hasCandidates) {
                    e.preventDefault()
                    pickEditedCandidate(i, candidates[0])
                  }
                  if (e.key === 'Escape') setEditingIndex(null)
                }}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-white/30"
              />
              {editingIndex === i && hasCandidates && (
                <div className={`absolute left-0 z-10 w-full overflow-y-auto rounded border border-white/10 bg-neutral-900 shadow-lg max-h-40 ${candidatesAbove ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                  {candidates.map((candidate) => {
                    const alreadySelected = selectedIds.includes(candidate.id)
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pickEditedCandidate(i, candidate)}
                        className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left text-sm transition hover:bg-white/10"
                      >
                        <span className="min-w-0 truncate">{candidate.name}</span>
                        <span className="shrink-0 text-xs text-neutral-500">{[candidate.type, candidate.country, `#${candidate.id}`, alreadySelected ? '已在列表中' : null].filter(Boolean).join(' · ')}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {a.artistId != null && <span className="shrink-0 text-xs text-neutral-500">#{a.artistId}</span>}
              {a.createNew && <span className="shrink-0 text-xs text-neutral-500">新增</span>}
              {showRole && (
                <select
                  value={a.role}
                  onChange={(e) => updateRole(i, e.target.value)}
                  className="bg-transparent border border-white/10 rounded text-xs px-1 py-0.5 outline-none"
                >
                  {ROLE_SUGGESTIONS.map((r) => (
                    <option key={r} value={r} className="bg-neutral-900">
                      {r}
                    </option>
                  ))}
                  {!ROLE_SUGGESTIONS.includes(a.role) && (
                    <option value={a.role} className="bg-neutral-900">
                      {a.role}
                    </option>
                  )}
                </select>
              )}
              {matched === false && (
                <select
                  value={a.type ?? ''}
                  onChange={(e) => updateType(i, e.target.value ? (e.target.value as 'Person' | 'Group') : null)}
                  className="bg-transparent border border-white/10 rounded text-xs px-1 py-0.5 outline-none"
                  title="新艺术家类型（Person/Group），入库时写入"
                >
                  <option value="" className="bg-neutral-900">
                    类型
                  </option>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value} className="bg-neutral-900">
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => moveArtist(i, -1)} className="text-neutral-500 hover:text-white text-xs">
                ↑
              </button>
              <button onClick={() => moveArtist(i, 1)} className="text-neutral-500 hover:text-white text-xs">
                ↓
              </button>
              <button onClick={() => removeArtist(i)} className="text-neutral-500 hover:text-red-400 text-xs">
                ✕
              </button>
            </div>
          )
        })}
      </div>}
    </div>
  )
}
