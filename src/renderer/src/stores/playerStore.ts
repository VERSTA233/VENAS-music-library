import { create } from 'zustand'
import type { AppendEntry, PlaybackSession } from '../../../shared/types'
import { isPermutation, playbackWeight, weightedOrder } from '../playback/weightedShuffle'

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
  nextShuffleOrder: number[]
  previousShuffleOrder: number[]
  /* 显式重新播放和切歌启动新聆听会话；seek/暂停不会改变它。 */
  playbackRun: number
  prepareShuffleRound: () => void
  advanceOrder: (step?: number) => Partial<PlayerState>
  recordHeard: (songId: number) => void
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
  requestSeek: (time: number) => void
  /* Append 曲目入库后，原地替换队列中的临时地址，保持当前播放位置与队列顺序。 */
  promoteAppendTrack: (appendFileName: string, musicTrack: PlayerTrack) => void
  removeAppendTrack: (appendFileName: string) => void
  removeSong: (songId: number) => void
  /* 歌曲改名或替换文件后更新队列中的正式地址；纯改名保留旧流，替换内容则加载新媒体并恢复进度。 */
  updateSongFile: (songId: number, fileName: string, audioReplaced: boolean) => void
  restoreSession: (session: PlaybackSession) => void
}

const heardDates = new Map<number, string>()
let historyReady = false
let historyRequest: Promise<void> | null = null
let playbackCommand = 0

export async function ensurePlaybackHistory(): Promise<void> {
  if (historyReady) return
  if (!historyRequest) {
    historyRequest = window.api.playback.lastHeardDates().then((rows) => {
      for (const row of rows) if (!heardDates.has(row.songId)) heardDates.set(row.songId, row.date)
      historyReady = true
    }).finally(() => { historyRequest = null })
  }
  await historyRequest
}

function shuffledIndexes(tracks: PlayerTrack[], currentIndex?: number, excludedFirst: number | null = null): number[] {
  const now = new Date()
  const weights = tracks.map((track) => playbackWeight(track.songId == null ? null : heardDates.get(track.songId), now))
  if (currentIndex == null) return weightedOrder(weights, excludedFirst)
  return [currentIndex, ...weightedOrder(weights).filter((index) => index !== currentIndex)]
}

/* 异步读取历史期间，新的播放命令覆盖旧命令，避免延迟查询把用户切回旧队列。 */
function withHistory(action: () => void): void {
  const command = ++playbackCommand
  if (historyReady) { action(); return }
  void ensurePlaybackHistory().then(() => {
    if (command === playbackCommand) action()
  }).catch(() => {
    if (command === playbackCommand) usePlayerStore.setState({ playbackError: '无法读取播放历史，请重试随机播放。' })
  })
}

function queueStart(state: PlayerState, tracks: PlayerTrack[], index: number, mode: PlaybackMode, order: number[]): Partial<PlayerState> {
  const track = tracks[index]
  const current = state.currentIndex == null ? null : state.queue[state.currentIndex]
  return {
    queue: tracks, currentIndex: index, playbackMode: mode, shuffleOrder: order,
    nextShuffleOrder: [], previousShuffleOrder: [], playbackRun: state.playbackRun + 1,
    isPlaying: true, currentTime: 0,
    /* 同曲重播保留 metadata，使进度条可立即拖动；nonce 强制音频回到开头。 */
    duration: current?.key === track.key ? state.duration : 0,
    seekRequest: { time: 0, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: track.key },
    transientPlaybackSource: null
  }
}

/* 预加载和手动切歌共用同一顺序，查询下一首不改变随机队列。 */
export function adjacentTrackIndex(state: Pick<PlayerState, 'queue' | 'currentIndex' | 'playbackMode' | 'shuffleOrder' | 'nextShuffleOrder' | 'previousShuffleOrder'>, step = 1): number | null {
  const { queue, currentIndex, playbackMode, shuffleOrder } = state
  if (currentIndex == null || queue.length === 0) return null
  if (playbackMode === 'shuffle' && shuffleOrder.length === queue.length) {
    const position = shuffleOrder.indexOf(currentIndex)
    if (position < 0) return null
    if (step > 0 && position === shuffleOrder.length - 1) return state.nextShuffleOrder[0] ?? null
    if (step < 0 && position === 0) return state.previousShuffleOrder.at(-1) ?? currentIndex
    return shuffleOrder[position + step]
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
  nextShuffleOrder: [],
  previousShuffleOrder: [],
  playbackRun: 0,
  prepareShuffleRound: () => {
    const state = get()
    if (state.playbackMode !== 'shuffle' || state.currentIndex == null || state.shuffleOrder.at(-1) !== state.currentIndex) return
    if (!historyReady || state.nextShuffleOrder.length === state.queue.length) return
    /* 固定下一轮首曲，预解码与实际切歌使用同一首；返回上一轮时保留已知的前进顺序。 */
    set({ nextShuffleOrder: shuffledIndexes(state.queue, undefined, state.currentIndex) })
  },
  advanceOrder: (step = 1) => {
    get().prepareShuffleRound()
    const state = get()
    const index = adjacentTrackIndex(state, step)
    if (index == null) return {}
    const update: Partial<PlayerState> = { currentIndex: index, playbackRun: state.playbackRun + 1 }
    if (state.playbackMode === 'shuffle') {
      const position = state.shuffleOrder.indexOf(state.currentIndex!)
      if (step > 0 && position === state.shuffleOrder.length - 1) {
        Object.assign(update, { previousShuffleOrder: state.shuffleOrder, shuffleOrder: state.nextShuffleOrder, nextShuffleOrder: [] })
      } else if (step < 0 && position === 0 && state.previousShuffleOrder.length) {
        Object.assign(update, { nextShuffleOrder: state.shuffleOrder, shuffleOrder: state.previousShuffleOrder, previousShuffleOrder: [] })
      }
    }
    return update
  },
  recordHeard: (songId) => {
    const date = new Date()
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    function remember(value: string): void {
      if (heardDates.get(songId) === value) return
      heardDates.set(songId, value)
      const state = get()
      if (state.nextShuffleOrder.length && state.queue[state.currentIndex!]?.songId === songId
        && state.shuffleOrder.at(-1) === state.currentIndex) {
        /* 末曲达到聆听阈值后刷新余下权重；已预加载的首曲保持不变，避免接缝重载。 */
        set({ nextShuffleOrder: shuffledIndexes(state.queue, state.nextShuffleOrder[0]) })
      }
    }
    remember(localDate)
    void window.api.playback.touchLastHeard(songId).then(remember).catch(() => {
      set({ playbackError: '最近播放日期保存失败，本次随机权重已在内存中更新。' })
    })
  },
  currentTime: 0,
  duration: 0,
  seekRequest: null,
  transientPlaybackSource: null,
  playQueue: (tracks, startIndex) => {
    if (!tracks[startIndex]) return
    if (get().playbackMode === 'shuffle' && !historyReady) {
      withHistory(() => get().playQueue(tracks, startIndex))
      return
    }
    ++playbackCommand
    const state = get()
    set(queueStart(state, tracks, startIndex, state.playbackMode,
      state.playbackMode === 'shuffle' ? shuffledIndexes(tracks, startIndex) : []))
  },
  playRandomQueue: (tracks) => {
    if (tracks.length === 0) return
    withHistory(() => {
      const order = shuffledIndexes(tracks)
      set(queueStart(get(), tracks, order[0], 'shuffle', order))
    })
  },
  togglePlay: () => {
    ++playbackCommand
    if (get().currentIndex === null) return
    set((s) => ({ isPlaying: !s.isPlaying }))
  },
  playNext: () => {
    if (get().playbackMode === 'shuffle' && !historyReady) { withHistory(() => get().playNext()); return }
    ++playbackCommand
    const update = get().advanceOrder()
    const state = get()
    const index = update.currentIndex
    if (index == null) return
    set({ ...update, isPlaying: true, currentTime: 0, duration: 0,
      seekRequest: { time: 0, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: state.queue[index].key }, transientPlaybackSource: null })
  },
  playPrev: () => {
    if (get().playbackMode === 'shuffle' && !historyReady) { withHistory(() => get().playPrev()); return }
    ++playbackCommand
    const update = get().advanceOrder(-1)
    const state = get()
    const index = update.currentIndex
    if (index == null) return
    set({ ...update, isPlaying: true, currentTime: 0, duration: 0,
      seekRequest: { time: 0, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: state.queue[index].key }, transientPlaybackSource: null })
  },
  playAt: (index) => {
    const { queue } = get()
    if (index < 0 || index >= queue.length) return
    get().playQueue(queue, index)
  },
  setPlaying: (playing) => { ++playbackCommand; set({ isPlaying: playing }) },
  setPlaybackMode: (mode) => {
    if (mode === 'shuffle' && !historyReady) {
      withHistory(() => get().setPlaybackMode(mode))
      return
    }
    ++playbackCommand
    const { queue, currentIndex } = get()
    set({ playbackMode: mode, shuffleOrder: mode === 'shuffle' && currentIndex !== null ? shuffledIndexes(queue, currentIndex) : [], nextShuffleOrder: [], previousShuffleOrder: [] })
  },
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
    ++playbackCommand
    const { queue, currentIndex, playbackMode } = get()
    if (currentIndex == null) return
    const currentTrackRemoved = queue[currentIndex]?.appendEntry?.fileName === appendFileName
    const removedBeforeCurrent = queue.slice(0, currentIndex).filter((track) => track.appendEntry?.fileName === appendFileName).length
    const nextQueue = queue.filter((track) => track.appendEntry?.fileName !== appendFileName)
    if (nextQueue.length === 0) {
      set({ queue: [], currentIndex: null, isPlaying: false, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: [], nextShuffleOrder: [], previousShuffleOrder: [], transientPlaybackSource: null })
      return
    }
    if (currentTrackRemoved) {
      const nextIndex = Math.min(currentIndex - removedBeforeCurrent, nextQueue.length - 1)
      set({ queue: nextQueue, currentIndex: nextIndex, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue, nextIndex) : [], nextShuffleOrder: [], previousShuffleOrder: [], playbackRun: get().playbackRun + 1, transientPlaybackSource: null })
      return
    }
    const nextIndex = currentIndex - removedBeforeCurrent
    set({ queue: nextQueue, currentIndex: nextIndex, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue, nextIndex) : [], nextShuffleOrder: [], previousShuffleOrder: [] })
  },
  removeSong: (songId) => {
    ++playbackCommand
    const { queue, currentIndex, playbackMode } = get()
    if (currentIndex == null) return
    const currentTrackRemoved = queue[currentIndex]?.songId === songId
    const removedBeforeCurrent = queue.slice(0, currentIndex).filter((track) => track.songId === songId).length
    const nextQueue = queue.filter((track) => track.songId !== songId)
    if (nextQueue.length === 0) {
      set({ queue: [], currentIndex: null, isPlaying: false, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: [], nextShuffleOrder: [], previousShuffleOrder: [], transientPlaybackSource: null })
      return
    }
    if (currentTrackRemoved) {
      const nextIndex = Math.min(currentIndex - removedBeforeCurrent, nextQueue.length - 1)
      set({ queue: nextQueue, currentIndex: nextIndex, isPlaying: true, currentTime: 0, duration: 0, seekRequest: null, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue, nextIndex) : [], nextShuffleOrder: [], previousShuffleOrder: [], playbackRun: get().playbackRun + 1, transientPlaybackSource: null })
      return
    }
    const nextIndex = currentIndex - removedBeforeCurrent
    set({ queue: nextQueue, currentIndex: nextIndex, shuffleOrder: playbackMode === 'shuffle' ? shuffledIndexes(nextQueue, nextIndex) : [], nextShuffleOrder: [], previousShuffleOrder: [] })
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
    ++playbackCommand
    if (!session.queue.length || session.currentIndex < 0 || session.currentIndex >= session.queue.length) return
    const order = session.playbackMode === 'shuffle'
      ? isPermutation(session.shuffleOrder, session.queue.length) ? session.shuffleOrder : shuffledIndexes(session.queue, session.currentIndex)
      : []
    set((state) => ({
      queue: session.queue,
      currentIndex: session.currentIndex,
      /* 恢复到可见且可继续的位置，但不在应用启动时自动播放。 */
      isPlaying: false,
      playbackMode: session.playbackMode,
      shuffleOrder: order,
      nextShuffleOrder: order.length && isPermutation(session.nextShuffleOrder, session.queue.length) && (session.queue.length === 1 || session.nextShuffleOrder[0] !== order.at(-1)) ? session.nextShuffleOrder : [],
      previousShuffleOrder: order.length && isPermutation(session.previousShuffleOrder, session.queue.length) && (session.queue.length === 1 || session.previousShuffleOrder.at(-1) !== order[0]) ? session.previousShuffleOrder : [],
      playbackRun: state.playbackRun + 1,
      currentTime: session.currentTime,
      duration: 0,
      transientPlaybackSource: null,
      seekRequest: { time: session.currentTime, nonce: (state.seekRequest?.nonce ?? 0) + 1, trackKey: session.queue[session.currentIndex].key }
    }))
    if (session.playbackMode === 'shuffle') {
      void ensurePlaybackHistory().then(() => {
        if (get().queue === session.queue) get().prepareShuffleRound()
      }).catch(() => { /* 日期暂不可读时保留恢复的顺序，后续手动随机仍会重试。 */ })
    }
  }
}))
