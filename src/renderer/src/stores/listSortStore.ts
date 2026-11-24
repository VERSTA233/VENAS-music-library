import { create } from 'zustand'
import type { ListSortPreferences, SortDirection } from '../../../shared/types'
import { defaultListSortPreferences, defaultSortDirection } from '../../../shared/listSorting'

interface ListSortState {
  preferences: ListSortPreferences
  setPreference: <K extends keyof ListSortPreferences>(key: K, preference: ListSortPreferences[K]) => void
}

export const useListSortStore = create<ListSortState>((set) => ({
  preferences: defaultListSortPreferences,
  setPreference: (key, preference) => {
    set(state => ({ preferences: { ...state.preferences, [key]: preference } }))
    void window.api.navigation.setListSortPreference(key, preference).catch(error => console.error('保存排序设置失败', error))
  }
}))

/* 网格与歌曲详情各自记忆排序；搜索词、滚动位置不进入此配置。 */
export function useListSort<K extends keyof ListSortPreferences>(key: K): {
  sort: ListSortPreferences[K]['sort']
  sortDirection: SortDirection
  setSort: (sort: ListSortPreferences[K]['sort']) => void
  setSortDirection: (direction: SortDirection) => void
} {
  const preference = useListSortStore(state => state.preferences[key])
  const setPreference = useListSortStore(state => state.setPreference)
  return {
    sort: preference.sort,
    sortDirection: preference.direction,
    setSort: (sort: ListSortPreferences[K]['sort']) => setPreference(key, { sort, direction: defaultSortDirection(sort) } as ListSortPreferences[K]),
    setSortDirection: (direction: SortDirection) => setPreference(key, { ...preference, direction })
  }
}
