import { ArrowDownAZ, ChevronDown } from 'lucide-react'
import type { ArtistListSort } from '../../../shared/types'

interface ArtistSortControlProps {
  value: ArtistListSort
  onChange: (sort: ArtistListSort) => void
}

/* Artist 第一层网格共用的排序菜单，视觉与歌曲排序按钮保持一致。 */
export default function ArtistSortControl({ value, onChange }: ArtistSortControlProps): React.JSX.Element {
  const label = value === 'name' ? '首字母' : value === 'count' ? '歌曲数量' : '音乐库顺序'
  return (
    <div className="relative h-8 shrink-0 rounded-lg bg-white/[0.06] text-neutral-400 transition hover:bg-white/[0.1] hover:text-neutral-200 active:scale-[0.97]">
      <div className="pointer-events-none flex h-full items-center gap-1.5 px-2" aria-hidden="true">
        <ArrowDownAZ size={15} />
        <span className="text-xs font-medium">{label}</span>
        <ChevronDown size={14} className="text-neutral-600" />
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ArtistListSort)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        aria-label="艺术家排序方式"
      >
        <option value="library">音乐库顺序</option>
        <option value="name">首字母</option>
        <option value="count">歌曲数量</option>
      </select>
    </div>
  )
}
