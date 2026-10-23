import { Search, X } from 'lucide-react'
import type { SongListSort, SortDirection } from '../../../shared/types'
import SongSortControl from './SongSortControl'

interface SongListToolbarActionsProps {
  query: string
  onQueryChange: (query: string) => void
  sort: SongListSort
  onSortChange: (sort: SongListSort) => void
  direction?: SortDirection
  onDirectionChange?: (direction: SortDirection) => void
  count: number
  searchLabel: string
  showSort?: boolean
  children?: React.ReactNode
}

/* 歌曲列表顶部操作区：所有歌曲视图复用同一搜索、排序和数量层级。 */
export default function SongListToolbarActions({
  query,
  onQueryChange,
  sort,
  onSortChange,
  direction = 'desc',
  onDirectionChange,
  count,
  searchLabel,
  showSort = true,
  children
}: SongListToolbarActionsProps): React.JSX.Element {
  return (
    <div className="ml-auto flex min-w-0 items-center gap-3">
      <label className="relative flex h-8 w-56 min-w-0 items-center rounded-lg bg-white/[0.06] text-neutral-400 transition focus-within:bg-white/[0.1]">
        <Search size={15} className="pointer-events-none absolute left-2.5 text-neutral-600" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索歌曲、艺术家、专辑或厂牌"
          className="h-full w-full min-w-0 bg-transparent py-1 pl-8 pr-7 text-xs text-neutral-200"
          aria-label={searchLabel}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition hover:bg-white/10 hover:text-white"
            title="清空搜索"
            aria-label="清空搜索"
          >
            <X size={14} />
          </button>
        )}
      </label>
      {showSort && onDirectionChange && <SongSortControl value={sort} onChange={onSortChange} direction={direction} onDirectionChange={onDirectionChange} />}
      <span className="shrink-0 text-xs tabular-nums text-neutral-500">{count} 首</span>
      {children}
    </div>
  )
}
