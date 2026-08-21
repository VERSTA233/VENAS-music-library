import { ArrowDownAZ, ChevronDown } from 'lucide-react'
import type { SongListItem, SongListSort } from '../../../shared/types'

interface SongSortControlProps {
  value: SongListSort
  onChange: (sort: SongListSort) => void
}

/* 歌曲页共用排序菜单；“音乐库顺序”保留调用方传入的原始业务顺序（例如专辑曲序）。 */
export default function SongSortControl({ value, onChange }: SongSortControlProps): React.JSX.Element {
  const label = value === 'title' ? '首字母' : value === 'addedAt' ? '添加时间' : '音乐库顺序'
  return (
    <div className="relative h-8 shrink-0 rounded-lg bg-white/[0.06] text-neutral-400 transition hover:bg-white/[0.1] hover:text-neutral-200 active:scale-[0.97]">
      <div className="pointer-events-none flex h-full items-center gap-1.5 px-2" aria-hidden="true">
        <ArrowDownAZ size={15} />
        <span className="text-xs font-medium">{label}</span>
        <ChevronDown size={14} className="text-neutral-600" />
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SongListSort)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        aria-label="歌曲排序方式"
      >
        <option value="library">音乐库顺序</option>
        <option value="title">首字母</option>
        <option value="addedAt">添加时间</option>
      </select>
    </div>
  )
}

/* 复制后再排序，避免改写查询得到的原始顺序，切回“音乐库顺序”时可无损恢复。 */
export function sortSongs<T extends SongListItem>(songs: T[], sort: SongListSort): T[] {
  if (sort === 'library') return songs

  return [...songs].sort((a, b) => {
    if (sort === 'title') {
      const titleOrder = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      return titleOrder || a.id - b.id
    }

    const aTime = a.add_time ? Date.parse(a.add_time) : Number.NEGATIVE_INFINITY
    const bTime = b.add_time ? Date.parse(b.add_time) : Number.NEGATIVE_INFINITY
    if (aTime !== bTime) return bTime - aTime
    return b.id - a.id
  })
}
