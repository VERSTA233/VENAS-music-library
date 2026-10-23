import { useEffect, useRef, useState } from 'react'
import type { ArtistRow } from '../../../shared/types'

export interface ArtistFormEntry {
  name: string
  role: string
  order: number
  /* 仅对红灯（未匹配数据库的新艺术家）使用，入库时传给后端；绿灯（已匹配）忽略此字段 */
  type: 'Person' | 'Group' | null
}

/* 角色建议值（非数据库约束，仅作为下拉的候选提示，用户可自由输入其他角色） */
const ROLE_SUGGESTIONS = ['Primary', 'Featured', 'Composer', 'Remixer']

interface ArtistPickerProps {
  artists: ArtistFormEntry[]
  onChange: (artists: ArtistFormEntry[]) => void
  /* 专辑艺术家场景下 album_artists 表没有 role 列，编辑时不展示角色选择器（role 字段仍保留但不会被读取） */
  showRole?: boolean
  /* 当用户修改某艺术家的 type 时，调用方可通过此回调同步另一列表中同名艺术家的 type（仅红灯时触发） */
  onTypeChange?: (name: string, type: 'Person' | 'Group' | null) => void
}

/* 艺术家类型建议值：仅新艺术家（红灯，即将新建）可编辑，已匹配数据库的艺术家沿用其已有 type，不在此处改动 */
const TYPE_OPTIONS: { value: 'Person' | 'Group'; label: string }[] = [
  { value: 'Person', label: 'Person' },
  { value: 'Group', label: 'Group' }
]

/* 歌曲/专辑的多艺术家编辑器：支持增删、改名、（可选）改角色、拖拽式上下调整顺序（用上下按钮代替拖拽，MVP 简化） */
export default function ArtistPicker({
  artists,
  onChange,
  showRole = true,
  onTypeChange
}: ArtistPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ArtistRow[]>([])
  const searchRequestRef = useRef(0)
  /* 按名称（trim 后原样，不转小写，匹配用 IPC 内部忽略大小写）缓存精确匹配结果，供左侧绿/红指示灯使用 */
  const [matchStatus, setMatchStatus] = useState<Record<string, boolean>>({})

  /* 每当艺术家名字列表变化，对尚未查询过的名字发起精确匹配查询：命中数据库已有记录（入库时会复用）显示绿色，否则红色（入库时会新建） */
  useEffect(() => {
    const names = Array.from(new Set(artists.map((a) => a.name.trim()).filter(Boolean)))
    const pending = names.filter((n) => !(n in matchStatus))
    if (pending.length === 0) return
    let cancelled = false
    Promise.all(pending.map((n) => window.api.artists.matchExact(n))).then((results) => {
      if (cancelled) return
      setMatchStatus((prev) => {
        const next = { ...prev }
        pending.forEach((n, i) => {
          next[n] = results[i]
        })
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [artists, matchStatus])

  async function handleQueryChange(value: string): Promise<void> {
    const requestId = ++searchRequestRef.current
    setQuery(value)
    if (!value.trim()) {
      setSuggestions([])
      return
    }
    const results = await window.api.artists.search(value)
    if (requestId === searchRequestRef.current) setSuggestions(results)
  }

  function addArtist(value: string | ArtistRow): void {
    const name = typeof value === 'string' ? value : value.name
    if (!name.trim()) return
    if (
      artists.some((artist) => artist.name.toLowerCase() === name.trim().toLowerCase())
    ) return
    searchRequestRef.current += 1
    onChange([...artists, { name: name.trim(), role: 'Primary', order: artists.length, type: 'Person' }])
    setQuery('')
    setSuggestions([])
  }

  function removeArtist(index: number): void {
    onChange(artists.filter((_, i) => i !== index).map((a, i) => ({ ...a, order: i })))
  }

  function updateName(index: number, name: string): void {
    onChange(artists.map((a, i) => (i === index ? { ...a, name } : a)))
  }

  function updateRole(index: number, role: string): void {
    onChange(artists.map((a, i) => (i === index ? { ...a, role } : a)))
  }

  function updateType(index: number, type: 'Person' | 'Group' | null): void {
    const target = artists[index]
    onChange(artists.map((a, i) => (i === index ? { ...a, type } : a)))
    onTypeChange?.(target.name.trim(), type)
  }

  function moveArtist(index: number, dir: -1 | 1): void {
    const target = index + dir
    if (target < 0 || target >= artists.length) return
    const next = [...artists]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next.map((a, i) => ({ ...a, order: i })))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addArtist(query)
            }
            if (e.key === 'Tab' && suggestions[0]) {
              e.preventDefault()
              addArtist(suggestions[0].name)
            }
          }}
          placeholder="搜索或输入艺术家"
          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-white/30"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-neutral-900 border border-white/10 rounded shadow-lg max-h-40 overflow-y-auto">
            {suggestions.map((a) => (
              <div
                key={a.id}
                onClick={() => addArtist(a.name)}
                className="px-2 py-1 text-sm hover:bg-white/10 cursor-default"
              >
                {a.name}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {artists.map((a, i) => {
          const trimmed = a.name.trim()
          const matched = trimmed ? matchStatus[trimmed] : undefined
          return (
            <div key={i} className="flex items-center gap-2 bg-white/5 rounded px-2 py-1">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  matched === undefined ? 'bg-neutral-600' : matched ? 'bg-green-500' : 'bg-red-500'
                }`}
                title={
                  matched === undefined ? '匹配中...' : matched ? '已匹配数据库中的艺术家' : '数据库中不存在，入库时将新建'
                }
              />
              <input
                value={a.name}
                onChange={(e) => updateName(i, e.target.value)}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-white/30"
              />
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
      </div>
    </div>
  )
}
