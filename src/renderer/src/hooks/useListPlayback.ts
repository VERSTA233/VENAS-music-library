import { useShallow } from 'zustand/react/shallow'
import { usePlayerStore } from '../stores/playerStore'

/* 列表只订阅曲目身份与播放操作，时间、音量和缓冲进度不会触发列表更新。 */
export function useListPlayback() {
  return usePlayerStore(useShallow(state => ({
    currentSongId: state.currentIndex === null ? null : state.queue[state.currentIndex]?.songId ?? null,
    currentKey: state.currentIndex === null ? null : state.queue[state.currentIndex]?.key ?? null,
    hasTrack: state.currentIndex !== null,
    playQueue: state.playQueue,
    playRandomQueue: state.playRandomQueue
  })))
}
