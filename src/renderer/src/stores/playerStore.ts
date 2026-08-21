import { create } from 'zustand'
import type { AppendEntry, PlaybackSession } from '../../../shared/types'

/*
 * 播放队列里的一个条目：Music 库歌曲带 songId（用于 last_heard 打点），Append 试听没有 songId；
 * appendEntry 与 songId 互斥，供底部播放条"···"按钮判断该打开歌曲信息弹窗还是入库弹窗
 */
export interface PlayerTrack {
  key: string
  title: string
  artistNames: string
  mediaUrl: string
  songId: number | null
  appendEntry: AppendEntry | null
}

export type PlaybackMode = 'sequential' | 'shuffle'

interface PlayerState {
  queue: PlayerTrack[]
  currentIndex: number | null
  isPlaying: boolean
  playbackMode: PlaybackMode
  shuffleOrder: number[]
  currentTime: number
  duration: number
  seekRequest: { time: number; nonce: number; trackKey: string } | null
  /* 入库瞬间仅供当前 <audio> 继续读取的旧 Append 地址，绝不写入播放会话。 */
  transientPlaybackSource: { trackKey: string; mediaUrl: string } | null
  /* 将给定队列设为播放队列，从 startIndex 开始播放 */
  playQueue: (tracks: PlayerTrack[], startIndex: number) => void
  /* 将给定队列设为随机播放队列，并立即随机选择一首开始播放。 */
  playRandomQueue: (tracks: PlayerTrack[]) => void
  togglePlay: () => void
  playNext: () => void
  playPrev: () => void
  playAt: (index: number) => void
  setPlaying: (playing: boolean) => void
  setPlaybackMode: (mode: PlaybackMode) => void
  setTimeline: (currentTime: number, duration?: number) => void
  requestSeek: (time: number) => void
  /* Append 曲目入库后，原地替换队列中的临时地址，保持当前播放位置与队列顺序。 */
  promoteAppendTrack: (appendFileName: string, musicTrack: PlayerTrack) => void
  removeAppendTrack: (appendFileName: string) => void
  removeSong: (songId: number) => void
  /* 歌曲改名或替换文件后更新队列中的正式地址；纯改名保留旧流，替换内容则加载新媒体并恢复进度。 */
  updateSongFile: (songId: number, fileName: string, audioReplaced: boolean) => void
  restoreSession: (session: PlaybackSession) => void
}

function shuffledIndexes(length: number, currentIndex: number): number[] {
  const remaining = Array.from({ length }, (_, index) => index).filter((index) => index !== currentIndex)
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[remaining[index], remaining[target]] = [remaining[target], remaining[index]]
  }
  return [currentIndex, ...remaining]
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: null,
  isPlaying: false,
  playbackMode: 'sequential',
  shuffleOrder: [],
  currentTime: 0,
  duration: 0,
  seekRequest: null,
  transientPlaybackSource: null,
  playQueue: (tracks, startIndex) => {
    const previousState = get()
    const mode = previousState.playbackMode
    const trackKey = tracks[startIndex]?.key
    const previousSeek = previousState.seekRequest
    const previousTrack = previousState.currentIndex == null
      ? null
      : previousState.queue[previousState.currentIndex] ?? null
    /* 同一媒体无需重新加载 metadata；保留已知时长才能让 range 继续可拖动。 */
    const isRestartingCurrentTrack = trackKey != null && previousTrack?.key === trackKey
    set({
      queue: tracks,
      currentIndex: startIndex,
      isPlaying: true,
      currentTime: 0,
      duration: isRestartingCurrentTrack ? previousState.duration : 0,
      /* 即使重新选择的是同一首歌，也用新的 nonce 强制音频引擎回到 0 秒。 */
      seekRequest: trackKey
        ? { time: 0, nonce: (previousSeek?.nonce ?? 0) + 1, trackKey }
        : null,
      transientPlaybackSource: null,
      shuffleOrder: mode === 'shuffle' ? shuffledIndexes(tracks.length, startIndex) : []
    })
  },
  playRandomQueue: (tracks) => {
    if (tracks.length === 0) return
    const startIndex = Math.floor(Math.random() * tracks.length)
    get().playQueue(tracks, startIndex)
    get().setPlaybackMode('shuffle')
  },
  togglePlay: () => {
    if (get().currentIndex === null) return
    set((s) => ({ isPlaying: !s.isPlaying }))
  },
  playNext: () => {
    const { queue, currentIndex, playbackMode, shuffleOrder } = get()
    if (currentIndex === null || queue.length === 0) return
    if (playbackMode === 'shuffle') {
      const order = shuffleOrder.length ? shuffleOrder : shuffledIndexes(queue.length, currentIndex)
      const position = order.indexOf(currentIndex)
      const nextPosition = (position + 1) % order.length
      set({ currentIndex: order[nextPosition], isPlaying: true, shuffleOrder: order, currentTime: 0, duration: 0, seekRequest: null, transientPlaybackSource: null })
      return
    }
    set({ currentIndex: (currentIndex + 1) % queue.length, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, transientPlaybackSource: null })
  },
  playPrev: () => {
    const { queue, currentIndex, playbackMode, shuffleOrder } = get()
    if (currentIndex === null || queue.length === 0) return
    if (playbackMode === 'shuffle') {
      const order = shuffleOrder.length ? shuffleOrder : shuffledIndexes(queue.length, currentIndex)
      const position = order.indexOf(currentIndex)
      set({ currentIndex: order[(position - 1 + order.length) % order.length], isPlaying: true, shuffleOrder: order, currentTime: 0, duration: 0, seekRequest: null, transientPlaybackSource: null })
      return
    }
    set({ currentIndex: (currentIndex - 1 + queue.length) % queue.length, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, transientPlaybackSource: null })
  },
  playAt: (index) => {
    const { queue, playbackMode } = get()
    if (index < 0 || index >= queue.length) return
    set({
      currentIndex: index,
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      seekRequest: null,
      transientPlaybackSource: null,
      shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(queue.length, index) : []
    })
  },
  setPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackMode: (mode) => {
    const { queue, currentIndex } = get()
    set({ playbackMode: mode, shuffleOrder: mode === 'shuffle' && currentIndex !== null ? shuffledIndexes(queue.length, currentIndex) : [] })
  },
  setTimeline: (currentTime, duration) => set((state) => ({ currentTime, duration: duration ?? state.duration })),
  requestSeek: (time) => {
    const { currentIndex, queue } = get()
    const trackKey = currentIndex == null ? null : queue[currentIndex]?.key
    if (!trackKey) return
    /* currentTime 只由 audio 的 timeupdate/seeked 确认，避免旧播放位置在 seek 生效前短暂回写。 */
    set((state) => ({ seekRequest: { time, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey } }))
  },
  promoteAppendTrack: (appendFileName, musicTrack) => {
    const state = get()
    const currentWasPromoted = state.currentIndex !== null && state.queue[state.currentIndex]?.appendEntry?.fileName === appendFileName
    const nextQueue = state.queue.map((track) =>
      track.appendEntry?.fileName === appendFileName ? musicTrack : track
    )
    if (nextQueue.every((track, index) => track === state.queue[index])) return

    const currentTrack = state.currentIndex == null ? null : state.queue[state.currentIndex]
    set({
      queue: nextQueue,
      /* 队列立即换成正式路径；活跃音频继续用原 URL，避免 Chromium 重载并打断缓冲。 */
      transientPlaybackSource: currentWasPromoted && currentTrack
        ? { trackKey: musicTrack.key, mediaUrl: currentTrack.mediaUrl }
        : state.transientPlaybackSource
    })
  },
  removeAppendTrack: (appendFileName) => {
    const { queue, currentIndex } = get()
    if (currentIndex == null) return
    const currentTrackRemoved = queue[currentIndex]?.appendEntry?.fileName === appendFileName
    const removedBeforeCurrent = queue.slice(0, currentIndex).filter((track) => track.appendEntry?.fileName === appendFileName).length
    const nextQueue = queue.filter((track) => track.appendEntry?.fileName !== appendFileName)
    if (nextQueue.length === 0) {
      set({ queue: [], currentIndex: null, isPlaying: false, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: [], transientPlaybackSource: null })
      return
    }
    if (currentTrackRemoved) {
      const nextIndex = Math.min(currentIndex - removedBeforeCurrent, nextQueue.length - 1)
      set({ queue: nextQueue, currentIndex: nextIndex, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: [], transientPlaybackSource: null })
      return
    }
    set({ queue: nextQueue, currentIndex: currentIndex - removedBeforeCurrent, shuffleOrder: [] })
  },
  removeSong: (songId) => {
    const { queue, currentIndex } = get()
    if (currentIndex == null) return
    const currentTrackRemoved = queue[currentIndex]?.songId === songId
    const removedBeforeCurrent = queue.slice(0, currentIndex).filter((track) => track.songId === songId).length
    const nextQueue = queue.filter((track) => track.songId !== songId)
    if (nextQueue.length === 0) {
      set({ queue: [], currentIndex: null, isPlaying: false, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: [], transientPlaybackSource: null })
      return
    }
    if (currentTrackRemoved) {
      const nextIndex = Math.min(currentIndex - removedBeforeCurrent, nextQueue.length - 1)
      set({ queue: nextQueue, currentIndex: nextIndex, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: [], transientPlaybackSource: null })
      return
    }
    set({ queue: nextQueue, currentIndex: currentIndex - removedBeforeCurrent, shuffleOrder: [] })
  },
  updateSongFile: (songId, fileName, audioReplaced) => {
    const state = get()
    const mediaUrl = window.api.songs.mediaUrl(fileName)
    const nextQueue = state.queue.map((track) => track.songId === songId ? { ...track, mediaUrl } : track)
    if (nextQueue.every((track, index) => track === state.queue[index])) return
    const currentTrack = state.currentIndex == null ? null : state.queue[state.currentIndex]
    const currentWasUpdated = currentTrack?.songId === songId
    const retainedPlaybackSource = currentTrack && state.transientPlaybackSource?.trackKey === currentTrack.key
      ? state.transientPlaybackSource.mediaUrl
      : currentTrack?.mediaUrl
    set({
      queue: nextQueue,
      transientPlaybackSource: currentWasUpdated && currentTrack && retainedPlaybackSource && !audioReplaced
        ? { trackKey: currentTrack.key, mediaUrl: retainedPlaybackSource }
        : currentWasUpdated ? null : state.transientPlaybackSource,
      seekRequest: currentWasUpdated && audioReplaced
        ? { time: state.currentTime, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: currentTrack.key }
        : state.seekRequest
    })
  },
  restoreSession: (session) => {
    if (!session.queue.length || session.currentIndex < 0 || session.currentIndex >= session.queue.length) return
    set((state) => ({
      queue: session.queue,
      currentIndex: session.currentIndex,
      /* 恢复到可见且可继续的位置，但不在应用启动时自动播放。 */
      isPlaying: false,
      playbackMode: session.playbackMode,
      shuffleOrder: session.shuffleOrder,
      currentTime: session.currentTime,
      duration: 0,
      transientPlaybackSource: null,
      seekRequest: { time: session.currentTime, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: session.queue[session.currentIndex].key }
    }))
  }
}))
