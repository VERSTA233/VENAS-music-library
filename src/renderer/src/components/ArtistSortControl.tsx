import type { ArtistListSort, SortDirection } from '../../../shared/types'
import SortMenu from './SortMenu'

interface ArtistSortControlProps {
  value: ArtistListSort
  onChange: (sort: ArtistListSort) => void
  direction: SortDirection
  onDirectionChange: (direction: SortDirection) => void
}

/* Artist 第一层网格共用的排序菜单，视觉与歌曲排序按钮保持一致。 */
export default function ArtistSortControl({ value, onChange, direction, onDirectionChange }: ArtistSortControlProps): React.JSX.Element {
  return (
    <SortMenu
      value={value}
      options={[{ value: 'library', label: '音乐库顺序' }, { value: 'name', label: '首字母' }, { value: 'count', label: '歌曲数量' }]}
      direction={direction}
      onChange={onChange}
      onDirectionChange={onDirectionChange}
      ariaLabel="艺术家排序方式"
      directionLabel="艺术家排序"
    />
  )
}
