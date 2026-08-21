import { ArrowDownAZ, ChevronDown } from 'lucide-react'
import type { AlbumListSort } from '../../../shared/types'

interface AlbumSortControlProps {
  value: AlbumListSort
  onChange: (sort: AlbumListSort) => void
}

/* Album 第一层网格排序菜单，沿用 Artist/Music 的视觉样式。 */
export default function AlbumSortControl({ value, onChange }: AlbumSortControlProps): React.JSX.Element {
  const label = value === 'title' ? '首字母' : value === 'count' ? '歌曲数量' : '音乐库顺序'
  return (
    <div className="relative h-8 shrink-0 rounded-lg bg-white/[0.06] text-neutral-400 transition hover:bg-white/[0.1] hover:text-neutral-200 active:scale-[0.97]">
      <div className="pointer-events-none flex h-full items-center gap-1.5 px-2" aria-hidden="true">
        <ArrowDownAZ size={15} />
        <span className="text-xs font-medium">{label}</span>
        <ChevronDown size={14} className="text-neutral-600" />
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as AlbumListSort)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        aria-label="专辑排序方式"
      >
        <option value="library">音乐库顺序</option>
        <option value="title">首字母</option>
        <option value="count">歌曲数量</option>
      </select>
    </div>
  )
}
