import type { SongListSort, SortDirection } from '../../../shared/types'
import ListSortControl from './ListSortControl'
import BrowseToolbarActions from './BrowseToolbarActions'

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
    <BrowseToolbarActions
      query={query}
      onQueryChange={onQueryChange}
      placeholder="搜索歌曲、艺术家、专辑或厂牌"
      searchLabel={searchLabel}
      sortControl={showSort && onDirectionChange && <ListSortControl kind="song" value={sort} onChange={onSortChange} direction={direction} onDirectionChange={onDirectionChange} />}
      count={count}
      countUnit="首"
    >
      {children}
    </BrowseToolbarActions>
  )
}
