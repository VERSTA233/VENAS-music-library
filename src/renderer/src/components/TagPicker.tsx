import { useRef, useState } from 'react'
import type { TagRow } from '../../../shared/types'
import { TAG_TYPE_OPTIONS } from '../tagTypes'

interface TagPickerProps {
  tags: TagRow[]
  onChange: (tags: TagRow[]) => void
}

/* 歌曲的多 Tag 编辑器：搜索已有 Tag 添加，或输入新名称 + 选类型创建 */
export default function TagPicker({ tags, onChange }: TagPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<TagRow[]>([])
  const [newTagType, setNewTagType] = useState<string>(TAG_TYPE_OPTIONS[0])
  const searchRequestRef = useRef(0)

  async function handleQueryChange(value: string): Promise<void> {
    const requestId = ++searchRequestRef.current
    setQuery(value)
    if (!value.trim()) {
      setSuggestions([])
      return
    }
    const results = await window.api.tags.search(value)
    if (requestId === searchRequestRef.current) setSuggestions(results)
  }

  function addExisting(tag: TagRow): void {
    if (tags.some((t) => t.id === tag.id)) return
    searchRequestRef.current += 1
    onChange([...tags, tag])
    setQuery('')
    setSuggestions([])
  }

  async function createAndAdd(): Promise<void> {
    const name = query.trim()
    if (!name) return
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return
    searchRequestRef.current += 1
    const id = await window.api.tags.create(name, newTagType)
    onChange([...tags, { id, name, tag_type: newTagType, description: null }])
    setQuery('')
    setSuggestions([])
  }

  function removeTag(id: number): void {
    onChange(tags.filter((t) => t.id !== id))
  }

  const exactMatch = suggestions.some((t) => t.name.toLowerCase() === query.trim().toLowerCase())

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex gap-2">
        <input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && suggestions[0]) {
              e.preventDefault()
              addExisting(suggestions[0])
            }
          }}
          placeholder="搜索或新建 Tag"
          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
        />
        {query.trim() && !exactMatch && (
          <>
            <select
              value={newTagType}
              onChange={(e) => setNewTagType(e.target.value)}
              className="bg-white/5 border border-white/10 rounded text-xs px-1 outline-none"
            >
              {TAG_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t} className="bg-neutral-900">
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={createAndAdd}
              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              新建
            </button>
          </>
        )}
        {suggestions.length > 0 && (
          <div className="absolute top-full z-10 mt-1 w-full bg-neutral-900 border border-white/10 rounded shadow-lg max-h-40 overflow-y-auto">
            {suggestions.map((t) => (
              <div
                key={t.id}
                onClick={() => addExisting(t)}
                className="px-2 py-1 text-sm hover:bg-white/10 cursor-default flex justify-between"
              >
                <span>{t.name}</span>
                <span className="text-neutral-500 text-xs">{t.tag_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t.id} className="flex items-center gap-1 bg-white/10 rounded px-2 py-0.5 text-xs">
            {t.name}
            <button onClick={() => removeTag(t.id)} className="text-neutral-400 hover:text-red-400">
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
