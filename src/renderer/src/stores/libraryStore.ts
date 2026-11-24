import { create } from 'zustand'
import type { SongListItem } from '../../../shared/types'
import { useListSortStore } from './listSortStore'

let requestVersion = 0
let invalidationVersion = 0

interface LibraryState {
  songs: SongListItem[]
  total: number
  query: string
  loading: boolean
  error: string | null
  loaded: boolean
  stale: boolean
  fetchSongs: () => Promise<void>
  ensureSongs: () => Promise<void>
  invalidateSongs: () => void
  setQuery: (query: string) => Promise<void>
  refresh: () => Promise<void>
}

/* Music 库完整列表状态：排序与搜索始终作用于同一份完整结果集。 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  total: 0,
  query: '',
  loading: false,
  error: null,
  loaded: false,
  stale: true,
  fetchSongs: async () => {
    const version = ++requestVersion
    const invalidationAtStart = invalidationVersion
    const { query } = get()
    const { sort, direction } = useListSortStore.getState().preferences.music
    set({ error: null, ...(!get().loaded ? { loading: true } : {}) })
    try {
      const { items, total } = await window.api.songs.list(sort, query, direction)
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
      if (version === requestVersion) set({ loading: false, error: error instanceof Error ? error.message : String(error) })
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

useListSortStore.subscribe((state, previous) => {
  if (state.preferences.music !== previous.preferences.music) useLibraryStore.getState().invalidateSongs()
})
