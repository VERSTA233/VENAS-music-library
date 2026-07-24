import { create } from 'zustand'

/* 播放队列里的一个条目：Music 库歌曲带 songId（用于 last_heard 打点），Append 试听没有 songId */
export interface PlayerTrack {
  key: string
  title: string
  artistNames: string
  mediaUrl: string
  songId: number | null
}

interface PlayerState {
  queue: PlayerTrack[]
  currentIndex: number | null
  isPlaying: boolean
  /* 将给定队列设为播放队列，从 startIndex 开始播放 */
  playQueue: (tracks: PlayerTrack[], startIndex: number) => void
  togglePlay: () => void
  playNext: () => void
  playPrev: () => void
  setPlaying: (playing: boolean) => void
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: null,
  isPlaying: false,
  playQueue: (tracks, startIndex) => {
    set({ queue: tracks, currentIndex: startIndex, isPlaying: true })
  },
  togglePlay: () => {
    if (get().currentIndex === null) return
    set((s) => ({ isPlaying: !s.isPlaying }))
  },
  playNext: () => {
    const { queue, currentIndex } = get()
    if (currentIndex === null || currentIndex + 1 >= queue.length) {
      set({ isPlaying: false })
      return
    }
    set({ currentIndex: currentIndex + 1, isPlaying: true })
  },
  playPrev: () => {
    const { currentIndex } = get()
    if (currentIndex === null || currentIndex - 1 < 0) return
    set({ currentIndex: currentIndex - 1, isPlaying: true })
  },
  setPlaying: (playing) => set({ isPlaying: playing })
}))
