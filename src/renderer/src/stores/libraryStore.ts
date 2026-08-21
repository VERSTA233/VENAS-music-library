import { create } from 'zustand'
import type { SongListItem, SongListSort } from '../../../shared/types'

let requestVersion = 0

interface LibraryState {
  songs: SongListItem[]
  total: number
  sort: SongListSort
  query: string
  loading: boolean
  fetchSongs: () => Promise<void>
  setSort: (sort: SongListSort) => Promise<void>
  setQuery: (query: string) => Promise<void>
  refresh: () => Promise<void>
}

/* Music 库完整列表状态：排序与搜索始终作用于同一份完整结果集。 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  total: 0,
  sort: 'library',
  query: '',
  loading: false,
  fetchSongs: async () => {
    const version = ++requestVersion
    const { sort, query } = get()
    set({ loading: true })
    const { items, total } = await window.api.songs.list(sort, query)
    if (version === requestVersion) set({ songs: items, total, loading: false })
  },
  setSort: async (sort: SongListSort) => {
    set({ sort })
    await get().fetchSongs()
  },
  setQuery: async (query: string) => {
    const normalized = query.trim()
    if (normalized === get().query) return
    set({ query: normalized })
    await get().fetchSongs()
  },
  refresh: async () => {
    await get().fetchSongs()
  }
}))
