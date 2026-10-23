import { useEffect } from 'react'
import { usePlayerStore } from '../stores/playerStore'
import { PlaybackEngine } from './PlaybackEngine'

/* 生命周期独立于底部条、页面与全屏播放器。 */
export default function AudioEngine(): React.JSX.Element | null {
  const error = usePlayerStore((state) => state.playbackError)
  useEffect(() => {
    let disposed = false
    let engine: PlaybackEngine | null = null
    let maintaining = false
    let receivedUpdate = false
    let unsubscribeVolume: (() => void) | null = null
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
    })
    void Promise.all([
      window.api.playback.getGapless().catch(() => true),
      window.api.library.getMaintenanceState().catch(() => null),
      window.api.playback.getVolume().catch(() => ({ volume: 1, muted: false }))
    ]).then(([enabled, maintenance, savedVolume]) => {
      if (disposed) return
      if (!receivedUpdate) maintaining = maintenance != null
      usePlayerStore.setState({ gaplessEnabled: enabled, gaplessReady: true,
        volume: Number.isFinite(savedVolume?.volume) ? Math.max(0, Math.min(1, savedVolume.volume)) : 1,
        muted: savedVolume?.muted === true })
      unsubscribeVolume = usePlayerStore.subscribe((state, previous) => {
        if (state.volume === previous.volume && state.muted === previous.muted) return
        if (saveTimer != null) clearTimeout(saveTimer)
        saveTimer = setTimeout(saveVolume, 200)
      })
      engine = new PlaybackEngine(maintaining)
    })
    return () => {
      disposed = true
      window.removeEventListener('pagehide', saveVolume)
      saveVolume()
      unsubscribeVolume?.()
      unsubscribe()
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
