import { useEffect, useState } from 'react'
import type { ArtistRow } from '../../../shared/types'

export interface ArtistFormEntry {
  name: string
  role: string
  order: number
}

/* 角色建议值（非数据库约束，仅作为下拉的候选提示，用户可自由输入其他角色） */
const ROLE_SUGGESTIONS = ['Primary', 'Featured', 'Composer', 'Producer', 'Remixer']

interface ArtistPickerProps {
  artists: ArtistFormEntry[]
  onChange: (artists: ArtistFormEntry[]) => void
  /* 专辑艺术家场景下 album_artists 表没有 role 列，编辑时不展示角色选择器（role 字段仍保留但不会被读取） */
  showRole?: boolean
}

/* 歌曲/专辑的多艺术家编辑器：支持增删、改名、（可选）改角色、拖拽式上下调整顺序（用上下按钮代替拖拽，MVP 简化） */
export default function ArtistPicker({ artists, onChange, showRole = true }: ArtistPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ArtistRow[]>([])
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
    setQuery(value)
    if (!value.trim()) {
      setSuggestions([])
      return
    }
    setSuggestions(await window.api.artists.search(value))
  }

  function addArtist(name: string): void {
    if (!name.trim()) return
    if (artists.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) return
    onChange([...artists, { name: name.trim(), role: 'Primary', order: artists.length }])
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
          }}
          placeholder="搜索或输入新艺术家名"
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
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
