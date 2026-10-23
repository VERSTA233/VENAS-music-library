import type { SongListItem, SongListSort, SortDirection } from '../../../shared/types'
import SortMenu from './SortMenu'

interface SongSortControlProps {
  value: SongListSort
  onChange: (sort: SongListSort) => void
  direction: SortDirection
  onDirectionChange: (direction: SortDirection) => void
}

/* 歌曲页共用排序菜单；“音乐库顺序”保留调用方传入的原始业务顺序（例如专辑曲序）。 */
export default function SongSortControl({ value, onChange, direction, onDirectionChange }: SongSortControlProps): React.JSX.Element {
  return (
    <SortMenu
      value={value}
      options={[{ value: 'library', label: '音乐库顺序' }, { value: 'title', label: '首字母' }, { value: 'addedAt', label: '添加时间' }]}
      direction={direction}
      onChange={onChange}
      onDirectionChange={onDirectionChange}
      ariaLabel="歌曲排序方式"
      directionLabel="歌曲排序"
    />
  )
}

/* 复制后再排序，避免改写查询得到的原始顺序，切回“音乐库顺序”时可无损恢复。 */
export function sortSongs<T extends SongListItem>(songs: T[], sort: SongListSort, direction?: SortDirection): T[] {
  if (sort === 'library') return direction === 'asc' ? [...songs].reverse() : songs

  const effectiveDirection = direction ?? (sort === 'addedAt' ? 'desc' : 'asc')
  const multiplier = effectiveDirection === 'asc' ? 1 : -1
  return [...songs].sort((a, b) => {
    if (sort === 'title') {
      const titleOrder = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      return multiplier * (titleOrder || a.id - b.id)
    }

    const aTime = a.add_time ? Date.parse(a.add_time) : Number.NEGATIVE_INFINITY
    const bTime = b.add_time ? Date.parse(b.add_time) : Number.NEGATIVE_INFINITY
    if (aTime !== bTime) return multiplier * (aTime - bTime)
    return multiplier * (a.id - b.id)
  })
}
