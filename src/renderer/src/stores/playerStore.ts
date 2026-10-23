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
  /* 文件内容变化时更新；纯改名、Append 入库不作废已解码的声音。 */
  contentVersion?: string
}

export type PlaybackMode = 'sequential' | 'shuffle'

export interface PlayerState {
  volume: number
  muted: boolean
  setVolume: (volume: number) => void
  toggleMute: () => void
  gaplessEnabled: boolean
  gaplessReady: boolean
  setGaplessEnabled: (enabled: boolean) => void
  playbackError: string | null
  backend: 'web-audio' | 'stream' | null
  queue: PlayerTrack[]
  currentIndex: number | null
  isPlaying: boolean
  /* 播放意图与实际时钟分开：读取、解码、缓冲期间不推进显示时间。 */
  isAdvancing: boolean
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

/* 预加载和手动切歌共用同一顺序，查询下一首不改变随机队列。 */
export function adjacentTrackIndex(state: Pick<PlayerState, 'queue' | 'currentIndex' | 'playbackMode' | 'shuffleOrder'>, step = 1): number | null {
  const { queue, currentIndex, playbackMode, shuffleOrder } = state
  if (currentIndex == null || queue.length === 0) return null
  if (playbackMode === 'shuffle' && shuffleOrder.length === queue.length && new Set(shuffleOrder).size === queue.length && shuffleOrder.every((index) => Number.isInteger(index) && index >= 0 && index < queue.length)) {
    const position = shuffleOrder.indexOf(currentIndex)
    return shuffleOrder[(position + step + queue.length) % queue.length]
  }
  return (currentIndex + step + queue.length) % queue.length
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  volume: 1,
  muted: false,
  setVolume: (volume) => {
    if (Number.isFinite(volume)) set({ volume: Math.max(0, Math.min(1, volume)), muted: false })
  },
  toggleMute: () => set((state) => state.volume === 0
    ? { volume: 1, muted: false }
    : { muted: !state.muted }),
  gaplessEnabled: true,
  gaplessReady: false,
  setGaplessEnabled: (enabled) => set({ gaplessEnabled: enabled }),
  playbackError: null,
  backend: null,
  queue: [],
  currentIndex: null,
  isPlaying: false,
  isAdvancing: false,
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
    const state = get()
    const index = adjacentTrackIndex(state)
    if (index == null) return
    set({ currentIndex: index, isPlaying: true, currentTime: 0, duration: 0,
      seekRequest: { time: 0, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: state.queue[index].key }, transientPlaybackSource: null })
  },
  playPrev: () => {
    const state = get()
    const index = adjacentTrackIndex(state, -1)
    if (index == null) return
    set({ currentIndex: index, isPlaying: true, currentTime: 0, duration: 0,
      seekRequest: { time: 0, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: state.queue[index].key }, transientPlaybackSource: null })
  },
  playAt: (index) => {
    const { queue, playbackMode } = get()
    if (index < 0 || index >= queue.length) return
    set({
      currentIndex: index,
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      seekRequest: { time: 0, nonce: (get().seekRequest?.nonce ?? 0) + 1, trackKey: queue[index].key },
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
    /* currentTime 由音频引擎确认，避免旧播放位置在 seek 生效前短暂回写。 */
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
    const { queue, currentIndex, playbackMode } = get()
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
      set({ queue: nextQueue, currentIndex: nextIndex, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue.length, nextIndex) : [], transientPlaybackSource: null })
      return
    }
    const nextIndex = currentIndex - removedBeforeCurrent
    set({ queue: nextQueue, currentIndex: nextIndex, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue.length, nextIndex) : [] })
  },
  removeSong: (songId) => {
    const { queue, currentIndex, playbackMode } = get()
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
      set({ queue: nextQueue, currentIndex: nextIndex, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue.length, nextIndex) : [], transientPlaybackSource: null })
      return
    }
    const nextIndex = currentIndex - removedBeforeCurrent
    set({ queue: nextQueue, currentIndex: nextIndex, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue.length, nextIndex) : [] })
  },
  updateSongFile: (songId, fileName, audioReplaced) => {
    const state = get()
    const contentVersion = audioReplaced ? crypto.randomUUID() : undefined
    const mediaUrl = window.api.songs.mediaUrl(fileName) + (contentVersion ? `?v=${contentVersion}` : '')
    const nextQueue = state.queue.map((track) => track.songId === songId ? { ...track, mediaUrl, contentVersion: contentVersion ?? track.contentVersion } : track)
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
