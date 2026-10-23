import type { AlbumListSort, SortDirection } from '../../../shared/types'
import SortMenu from './SortMenu'

interface AlbumSortControlProps {
  value: AlbumListSort
  onChange: (sort: AlbumListSort) => void
  direction: SortDirection
  onDirectionChange: (direction: SortDirection) => void
}

/* Album 第一层网格排序菜单，沿用 Artist/Music 的视觉样式。 */
export default function AlbumSortControl({ value, onChange, direction, onDirectionChange }: AlbumSortControlProps): React.JSX.Element {
  return (
    <SortMenu
      value={value}
      options={[{ value: 'library', label: '音乐库顺序' }, { value: 'title', label: '首字母' }, { value: 'count', label: '歌曲数量' }]}
      direction={direction}
      onChange={onChange}
      onDirectionChange={onDirectionChange}
      ariaLabel="专辑排序方式"
      directionLabel="专辑排序"
    />
  )
}
