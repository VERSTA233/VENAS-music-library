import { ensurePlaybackHistory, usePlayerStore } from '../src/renderer/src/stores/playerStore'
import { PlaybackEngine } from '../src/renderer/src/playback/PlaybackEngine'
import { observeAudioVisualization, readAudioVisualization } from '../src/renderer/src/playback/audioVisualization'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check: () => boolean, label: string): Promise<void> {
  const until = performance.now() + 5000
  while (!check()) {
    if (performance.now() > until) throw new Error(`Timed out: ${label}; ${JSON.stringify(usePlayerStore.getState())}`)
    await delay(10)
  }
}
function check(condition: boolean, label: string): void { if (!condition) throw new Error(label) }

function testWave(): ArrayBuffer {
  const samples = 16000
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  function text(at: number, value: string): void { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 4096), true)
  return buffer
}

async function run(): Promise<string[]> {
  const heard: number[] = []
  const wave = testWave()
  const url = URL.createObjectURL(new Blob([wave], { type: 'audio/wav' }))
  window.api = { playback: {
    lastHeardDates: async () => [],
    touchLastHeard: async (id: number) => { heard.push(id); return new Date().toLocaleDateString('sv-SE') },
    inspectFile: async () => ({ duration: 2, channels: 1, sampleRate: 8000, size: wave.byteLength, version: 'test' })
  } } as never
  const originalFetch = window.fetch
  window.fetch = async () => new Response(wave.slice(0))
  const results: string[] = []
  try {
    await ensurePlaybackHistory()
    for (const gapless of [true, false]) {
      heard.length = 0
      usePlayerStore.setState(usePlayerStore.getInitialState(), true)
      usePlayerStore.setState({ gaplessEnabled: gapless, volume: 0 })
      const engine = new PlaybackEngine()
      let stopVisualization: (() => void) | null = null
      try {
        const queue = [1, 2].map((id) => ({ key: `song:${id}`, songId: id, title: String(id), artistNames: '',
          appendEntry: null, mediaUrl: url }))
        usePlayerStore.getState().playQueue(queue, 0)
        await waitFor(() => usePlayerStore.getState().currentTime >= 0.2, 'initial playback')
        check(usePlayerStore.getState().backend === (gapless ? 'web-audio' : 'stream'), 'Expected actual audio backend')
        check(readAudioVisualization() === null, 'Analysis started while hidden')
        stopVisualization = observeAudioVisualization()
        await waitFor(() => readAudioVisualization()?.trackKey === 'song:1', 'visualization source')
        usePlayerStore.getState().setVolume(0.01)
        await waitFor(() => {
          const frame = readAudioVisualization()
          return frame != null && Array.from(frame.frequencies).some(value => Number.isFinite(value) && value > -100)
        }, 'real frequency data')
        usePlayerStore.getState().setVolume(0)
        const visualization = readAudioVisualization()!
        check(visualization.waveformComplete === gapless, 'Waveform completeness is incorrect')
        check(visualization.waveform.some(value => value > 0), 'Waveform has no audio samples')
        stopVisualization(); stopVisualization = null
        const withoutVisualization = usePlayerStore.getState().currentTime
        await waitFor(() => usePlayerStore.getState().currentTime > withoutVisualization + 0.1, 'closing visualization preserves playback')
        stopVisualization = observeAudioVisualization()
        check(readAudioVisualization()?.trackKey === 'song:1', 'Reopened visualization did not reconnect')
        usePlayerStore.getState().requestSeek(1.8)
        await waitFor(() => usePlayerStore.getState().currentIndex === 1, 'seek then end')
        check(!heard.includes(1), 'Seeking to end must not mark heard')
        await waitFor(() => usePlayerStore.getState().currentTime >= 0.25, 'second track')
        check(readAudioVisualization()?.trackKey === 'song:2', 'Analysis retained previous track')
        usePlayerStore.getState().setPlaying(false)
        await delay(150)
        const paused = usePlayerStore.getState().currentTime
        await delay(300)
        check(Math.abs(usePlayerStore.getState().currentTime - paused) < 0.03, 'Paused time moved')
        usePlayerStore.getState().setPlaying(true)
        await waitFor(() => usePlayerStore.getState().currentTime >= 0.55, 'resume')
        check(heard.length === 0, 'Paused wall time counted as listening')
        usePlayerStore.getState().requestSeek(0)
        await waitFor(() => heard.includes(2), 'repeated passage reaches listening threshold')
        check(heard.filter((id) => id === 2).length === 1, 'Heard must update only once per session')
        results.push(`${gapless ? 'Web Audio' : 'HTMLAudio'}: live spectrum, waveform, reopen and track changes passed`)
        results.push(`${gapless ? 'Web Audio' : 'HTMLAudio'}: seek, pause/resume, repeated-listening threshold passed`)
        usePlayerStore.getState().requestSeek(0.3)
        await waitFor(() => usePlayerStore.getState().currentTime >= 0.35 && usePlayerStore.getState().currentTime < 0.8, 'before simulated sleep')
        const oldContext = (engine as any).context as AudioContext | null
        const oldAudio = (engine as any).audio
        const oldBuffer = (engine as any).active?.buffer
        engine.setSystemSuspended(true)
        const sleepingPosition = usePlayerStore.getState().currentTime
        await delay(250)
        check(usePlayerStore.getState().currentTime === sleepingPosition, 'Sleep changed position')
        const recoveryStarted = performance.now()
        engine.setSystemSuspended(false)
        if (gapless) check((engine as any).active?.buffer === oldBuffer, 'Wake did not reuse decoded PCM immediately')
        await waitFor(() => usePlayerStore.getState().currentTime > sleepingPosition + 0.1 && usePlayerStore.getState().isAdvancing, 'wake output advances')
        const recoveryMs = Math.round(performance.now() - recoveryStarted)
        check(readAudioVisualization()?.trackKey === 'song:2', 'Analysis did not recover after wake')
        if (gapless) {
          check((engine as any).context !== oldContext, 'Old AudioContext reused after wake')
          check(oldContext?.state === 'closed', 'Old AudioContext not released')
        } else check((engine as any).audio !== oldAudio, 'Old HTMLAudio reused after wake')
        usePlayerStore.getState().playNext()
        await waitFor(() => usePlayerStore.getState().currentTime > 0.1 && usePlayerStore.getState().isAdvancing, 'next track after wake')
        usePlayerStore.getState().setPlaying(false)
        engine.setSystemSuspended(true)
        engine.setSystemSuspended(false)
        await waitFor(() => usePlayerStore.getState().duration === 2, 'paused wake loaded')
        await delay(150)
        check(!usePlayerStore.getState().isPlaying && !usePlayerStore.getState().isAdvancing, 'Paused track resumed on wake')
        results.push(`${gapless ? 'Web Audio' : 'HTMLAudio'}: simulated sleep/wake rebuilds output, preserves position/pause and supports next; clock advances within ${recoveryMs} ms${gapless ? ', reuses PCM without decoding' : ''}`)
      } finally { stopVisualization?.(); engine.dispose() }
    }
    for (const unfinished of [false, true]) {
      usePlayerStore.setState(usePlayerStore.getInitialState(), true)
      const reads: string[] = []
      let finish!: () => void
      const preload = new Promise<void>((resolve) => { finish = resolve })
      const nextUrl = `${url}?manual-next=202`
      window.api.playback.inspectFile = async (mediaUrl) => {
        reads.push(mediaUrl)
        if (unfinished && mediaUrl === nextUrl) await preload
        return { duration: 2, channels: 1, sampleRate: 8000, size: wave.byteLength, version: 'test' }
      }
      const engine = new PlaybackEngine()
      try {
        const queue = [201, 202, 203].map((id) => ({ key: `song:${id}`, songId: id, title: String(id), artistNames: '',
          appendEntry: null, mediaUrl: `${url}?manual-next=${id}` }))
        usePlayerStore.getState().playQueue(queue, 0)
        await waitFor(() => usePlayerStore.getState().currentTime >= 0.2, 'manual next initial playback')
        await waitFor(() => unfinished ? reads.includes(nextUrl) : !!(engine as any).next, 'preload next track')
        const before = performance.now()
        usePlayerStore.getState().playNext()
        if (!unfinished) check(usePlayerStore.getState().duration === 2, 'Ready preload was not reused synchronously')
        else finish()
        await waitFor(() => usePlayerStore.getState().currentTime > 0 && usePlayerStore.getState().isAdvancing, 'manual next audio advances')
        check(reads.filter((mediaUrl) => mediaUrl === nextUrl).length === 1, 'Next track was read twice')
        check(usePlayerStore.getState().currentIndex === 1, 'Unexpected track after manual next')
        results.push(`Manual next (${unfinished ? 'in-flight' : 'ready'} preload): one read; audio advances after ${Math.round(performance.now() - before)} ms`)
      } finally { finish(); engine.dispose() }
    }
  } finally { window.fetch = originalFetch; URL.revokeObjectURL(url) }
  return results
}

export const result = run()
