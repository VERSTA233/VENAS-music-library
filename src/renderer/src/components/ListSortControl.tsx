import type { SortDirection } from '../../../shared/types'
import { listSortConfigs, type SortValue } from '../../../shared/listSorting'
import SortMenu from './SortMenu'

interface ListSortControlProps<K extends keyof SortValue> {
  kind: K
  value: SortValue[K]
  onChange: (value: SortValue[K]) => void
  direction: SortDirection
  onDirectionChange: (direction: SortDirection) => void
}

/* 歌曲、艺术家、专辑只定义各自选项，共用排序菜单与升降序操作。 */
export default function ListSortControl<K extends keyof SortValue>({ kind, ...props }: ListSortControlProps<K>): React.JSX.Element {
  const config = listSortConfigs[kind]
  return <SortMenu {...props} options={config.options} ariaLabel={`${config.label}排序方式`} directionLabel={`${config.label}排序`} />
}
