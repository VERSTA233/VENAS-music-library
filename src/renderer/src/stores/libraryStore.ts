import { create } from 'zustand'
import type { SongListItem } from '../../../shared/types'

const PAGE_SIZE = 50

interface LibraryState {
  songs: SongListItem[]
  total: number
  offset: number
  loading: boolean
  fetchPage: (offset: number) => Promise<void>
  refresh: () => Promise<void>
}

/* Music 库分页列表状态，MVP 阶段仅 List 视图，分页大小固定 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  total: 0,
  offset: 0,
  loading: false,
  fetchPage: async (offset: number) => {
    set({ loading: true })
    const { items, total } = await window.api.songs.list(offset, PAGE_SIZE)
    set({ songs: items, total, offset, loading: false })
  },
  refresh: async () => {
    await get().fetchPage(get().offset)
  }
}))

export { PAGE_SIZE }
