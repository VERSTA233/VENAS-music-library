import type { AlbumListSort, ArtistListSort, SongListSort, SortDirection } from '../../../shared/types'
import SortMenu from './SortMenu'

type SortValue = { song: SongListSort; artist: ArtistListSort; album: AlbumListSort }
const configs: { [K in keyof SortValue]: { label: string; options: { value: SortValue[K]; label: string }[] } } = {
  song: { label: '歌曲', options: [{ value: 'library', label: '音乐库顺序' }, { value: 'title', label: '首字母' }, { value: 'addedAt', label: '添加时间' }] },
  artist: { label: '艺术家', options: [{ value: 'library', label: '音乐库顺序' }, { value: 'name', label: '首字母' }, { value: 'count', label: '歌曲数量' }] },
  album: { label: '专辑', options: [{ value: 'library', label: '音乐库顺序' }, { value: 'title', label: '首字母' }, { value: 'count', label: '歌曲数量' }] }
}

interface ListSortControlProps<K extends keyof SortValue> {
  kind: K
  value: SortValue[K]
  onChange: (value: SortValue[K]) => void
  direction: SortDirection
  onDirectionChange: (direction: SortDirection) => void
}

/* 歌曲、艺术家、专辑只定义各自选项，共用排序菜单与升降序操作。 */
export default function ListSortControl<K extends keyof SortValue>({ kind, ...props }: ListSortControlProps<K>): React.JSX.Element {
  const config = configs[kind]
  return <SortMenu {...props} options={config.options} ariaLabel={`${config.label}排序方式`} directionLabel={`${config.label}排序`} />
}
