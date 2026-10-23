import { create } from 'zustand'
import type { SongListItem, SongListSort, SortDirection } from '../../../shared/types'

let requestVersion = 0
let invalidationVersion = 0

interface LibraryState {
  songs: SongListItem[]
  total: number
  sort: SongListSort
  sortDirection: SortDirection
  query: string
  loading: boolean
  loaded: boolean
  stale: boolean
  fetchSongs: () => Promise<void>
  ensureSongs: () => Promise<void>
  invalidateSongs: () => void
  setSort: (sort: SongListSort) => Promise<void>
  setSortDirection: (direction: SortDirection) => Promise<void>
  setQuery: (query: string) => Promise<void>
  refresh: () => Promise<void>
}

/* Music 库完整列表状态：排序与搜索始终作用于同一份完整结果集。 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  total: 0,
  sort: 'library',
  sortDirection: 'desc',
  query: '',
  loading: false,
  loaded: false,
  stale: true,
  fetchSongs: async () => {
    const version = ++requestVersion
    const invalidationAtStart = invalidationVersion
    const { sort, sortDirection, query } = get()
    if (!get().loaded) set({ loading: true })
    try {
      const { items, total } = await window.api.songs.list(sort, query, sortDirection)
      if (version === requestVersion) {
        set({
          songs: items,
          total,
          loading: false,
          loaded: true,
          stale: invalidationAtStart !== invalidationVersion
        })
      }
    } catch (error) {
      if (version === requestVersion) set({ loading: false })
      throw error
    }
  },
  ensureSongs: async () => {
    const { loaded, stale } = get()
    if (loaded && !stale) return
    await get().fetchSongs()
  },
  invalidateSongs: () => {
    invalidationVersion += 1
    set({ stale: true })
  },
  setSort: async (sort: SongListSort) => {
    set({ sort, sortDirection: sort === 'title' ? 'asc' : 'desc' })
    await get().fetchSongs()
  },
  setSortDirection: async (sortDirection: SortDirection) => {
    set({ sortDirection })
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
