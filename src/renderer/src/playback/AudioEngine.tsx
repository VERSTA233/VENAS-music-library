import { useEffect } from 'react'
import { ensurePlaybackHistory, usePlayerStore } from '../stores/playerStore'
import { PlaybackEngine } from './PlaybackEngine'

/* 生命周期独立于底部条、页面与全屏播放器。 */
export default function AudioEngine(): React.JSX.Element | null {
  const error = usePlayerStore((state) => state.playbackError)
  useEffect(() => {
    let disposed = false
    let engine: PlaybackEngine | null = null
    let maintaining = false
    let receivedUpdate = false
    let systemSuspended = false
    let receivedPowerUpdate = false
    let unsubscribeVolume: (() => void) | null = null
    let unsubscribeNowPlaying: (() => void) | null = null
    let lastNowPlaying: string | null = null
    const updateNowPlaying = (): void => {
      const state = usePlayerStore.getState()
      const track = state.currentIndex === null ? null : state.queue[state.currentIndex]
      const data = track && !maintaining && !systemSuspended ? {
        title: track.title, artist: track.artistNames,
        duration: Math.max(0, state.duration), position: Math.max(0, state.currentTime), playing: state.isPlaying
      } : null
      // Native Now Playing extrapolates time; do not send the 100 ms UI tick over IPC.
      const signature = data ? [track?.key, data.title, data.artist, data.duration, data.playing,
        state.seekRequest?.nonce ?? 0, Math.floor(data.position / 15)].join('|') : ''
      if (signature === lastNowPlaying) return
      lastNowPlaying = signature
      window.api.playback.updateNowPlaying(data)
    }
    const unsubscribeRemoteCommand = window.api.playback.onRemoteCommand((command) => {
      if (disposed || maintaining || systemSuspended) return
      const state = usePlayerStore.getState()
      if (state.currentIndex === null) return
      if (command === 'pause' && state.isPlaying) state.setPlaying(false)
      else if (command === 'play' && !state.isPlaying) state.setPlaying(true)
      else if (command === 'toggle') state.togglePlay()
      else if (command === 'next') state.playNext()
      else if (command === 'previous') state.playPrev()
    })
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    function saveVolume(): void {
      if (saveTimer == null) return
      clearTimeout(saveTimer)
      saveTimer = null
      const { volume, muted } = usePlayerStore.getState()
      void window.api.playback.setVolume({ volume, muted }).catch(() => {
        if (!disposed) usePlayerStore.setState({ playbackError: '音量已调整，但设置保存失败。' })
      })
    }
    window.addEventListener('pagehide', saveVolume)
    const unsubscribe = window.api.library.onMaintenanceChange((state) => {
      receivedUpdate = true
      maintaining = state != null
      engine?.setMaintenance(maintaining)
      updateNowPlaying()
    })
    const unsubscribePower = window.api.playback.onSystemSuspended((suspended) => {
      receivedPowerUpdate = true
      systemSuspended = suspended
      engine?.setSystemSuspended(suspended)
      updateNowPlaying()
    })
    void Promise.all([
      window.api.playback.getGapless().catch(() => true),
      window.api.library.getMaintenanceState().catch(() => null),
      window.api.playback.getVolume().catch(() => ({ volume: 1, muted: false })),
      ensurePlaybackHistory().catch(() => undefined),
      window.api.playback.getSystemSuspended()
    ]).then(([enabled, maintenance, savedVolume, , suspended]) => {
      if (disposed) return
      if (!receivedUpdate) maintaining = maintenance != null
      if (!receivedPowerUpdate) systemSuspended = suspended
      usePlayerStore.setState({ gaplessEnabled: enabled, gaplessReady: true,
        volume: Number.isFinite(savedVolume?.volume) ? Math.max(0, Math.min(1, savedVolume.volume)) : 1,
        muted: savedVolume?.muted === true })
      unsubscribeVolume = usePlayerStore.subscribe((state, previous) => {
        if (state.volume === previous.volume && state.muted === previous.muted) return
        if (saveTimer != null) clearTimeout(saveTimer)
        saveTimer = setTimeout(saveVolume, 200)
      })
      engine = new PlaybackEngine(maintaining, systemSuspended)
      unsubscribeNowPlaying = usePlayerStore.subscribe(() => updateNowPlaying())
      updateNowPlaying()
    })
    return () => {
      disposed = true
      window.api.playback.updateNowPlaying(null)
      unsubscribeRemoteCommand()
      unsubscribeNowPlaying?.()
      window.removeEventListener('pagehide', saveVolume)
      saveVolume()
      unsubscribeVolume?.()
      unsubscribe()
      unsubscribePower()
      engine?.dispose()
    }
  }, [])

  if (!error) return null
  return (
    <div role="alert" className="fixed bottom-24 left-1/2 z-[150] flex max-w-[80vw] -translate-x-1/2 items-center gap-4 rounded-xl border border-red-400/20 bg-neutral-900 px-4 py-3 text-sm text-red-300 shadow-xl">
      <span>{error}</span>
      <button type="button" onClick={() => usePlayerStore.setState({ playbackError: null })} className="shrink-0 text-xs text-neutral-400 hover:text-white">关闭</button>
    </div>
  )
}
