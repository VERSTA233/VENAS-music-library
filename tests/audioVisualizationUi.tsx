import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AudioVisualizer from '../src/renderer/src/components/AudioVisualizer'
import { colors } from '../src/shared/colors'
import '../src/renderer/src/assets/audio-visualizer.css'
import { observeAudioVisualization, readAudioVisualization, registerAudioVisualization, spectrumLevels, waveformPeaks } from '../src/renderer/src/playback/audioVisualization'

function check(value: unknown, message: string): void { if (!value) throw new Error(message) }
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function run(): Promise<string[]> {
  const results: string[] = []
  const buffer = new AudioBuffer({ length: 4000, numberOfChannels: 2, sampleRate: 8000 })
  buffer.getChannelData(0).fill(0.25)
  buffer.getChannelData(1).fill(-0.75)
  const envelope = waveformPeaks(buffer, 10)
  check(envelope.length === 10 && envelope.every(value => value === 0.75), 'Waveform lost a channel or cancelled opposite polarity')
  const silence = new AudioBuffer({ length: 100, sampleRate: 8000 })
  check(waveformPeaks(silence, 10).every(value => value === 0), 'Silence produced a fake waveform')
  const bands = new Float32Array(96)
  spectrumLevels(new Float32Array(4096).fill(-Infinity), 48000, 8192, bands)
  check(bands.every(value => value === 0), 'Silent spectrum was not empty')
  spectrumLevels(new Float32Array(4096).fill(-45), 48000, 8192, bands)
  check(bands.every(value => Math.abs(value - 0.5) < 0.001), 'Spectrum decibel scale changed')
  results.push('Stereo waveform preserves peak amplitudes; silence and logarithmic decibel mapping are correct')

  let reads = 0, releases = 0
  const frequencies = Float32Array.from({ length: 4096 }, (_, index) => -38 - Math.log10(index + 1) * 8 + Math.sin(index * 0.07) * 5)
  const waveform = Float32Array.from({ length: 640 }, (_, index) => 0.15 + Math.abs(Math.sin(index * 0.11) * Math.cos(index * 0.034)) * 0.8)
  const unregister = registerAudioVisualization({
    read: () => {
      reads++
      return { trackKey: 'test:1', sampleRate: 48000, fftSize: 8192, frequencies, samples: Float32Array.from({ length: 8192 }, (_, index) => index % 2 ? 0.5 : 0), waveform, waveformComplete: true }
    },
    release: () => { releases++ }
  })
  check(readAudioVisualization() === null && reads === 0, 'Analysis ran without a visible observer')
  const stop1 = observeAudioVisualization(), stop2 = observeAudioVisualization()
  check(readAudioVisualization()?.sampleRate === 48000, 'Analysis source did not provide data')
  stop1(); stop1()
  check(releases === 0, 'One observer stopped another observer’s analyser')
  stop2()
  check(releases === 1 && readAudioVisualization() === null, 'Last observer did not release analysis')
  results.push('Analysis starts only while observed and releases once the last observer leaves')

  const host = document.createElement('div')
  host.style.cssText = 'width:420px;height:480px'
  document.body.append(host)
  for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--palette-${key}`, value)
  const root = createRoot(host)
  const seek: number[] = []
  const openedTags: number[] = []
  const formatRequests: { url: string; resolve: (format: { sampleRate: number }) => void }[] = []
  window.api = { playback: { formatInfo: (url: string) => new Promise(resolve => formatRequests.push({ url, resolve })) } } as never
  const props = { trackKey: 'test:1', mediaUrl: 'venas-media://music/test.flac', genre: [{ id: 1, name: 'Electronic', tag_type: 'Genre' }, { id: 2, name: 'Ambient', tag_type: 'Genre' }], mood: [{ id: 3, name: 'Sorrow', tag_type: 'Mood' }], onOpenTag: (tag: { id: number }) => { openedTags.push(tag.id) }, active: true, currentTime: 42, duration: 180, isPlaying: true, isAdvancing: true, onSeek: (time: number) => { seek.push(time) } }
  try {
    flushSync(() => root.render(<AudioVisualizer {...props} />))
    check(formatRequests.length === 1, 'Source format request was not made once')
    formatRequests[0].resolve({ sampleRate: 44100 })
    await delay(500)
    check(host.innerText.includes('PLAYING') && !host.innerText.includes('BPM'), 'Unexpected status or BPM was rendered')
    check(host.innerText.includes('44.1') && !host.innerText.includes('48.0'), 'Sample rate came from the analysis context instead of the source file')
    const heading = host.querySelector<HTMLElement>('.audio-visualizer-title')!
    const status = host.querySelector<HTMLElement>('.audio-visualizer-status')!
    check(heading.textContent === 'SPECTRUM' && !host.querySelector('header')!.textContent!.includes('频谱'), 'Spectrum heading is not English only')
    check(getComputedStyle(status).color === getComputedStyle(heading).color, 'Playing status does not use the bright spectrum color')
    check(host.querySelector('.audio-visualizer-tags')!.textContent === 'GENREElectronic / AmbientMOODSorrow', 'Genre or mood metadata is missing')
    for (const button of host.querySelectorAll<HTMLButtonElement>('.audio-visualizer-tag-link')) button.click()
    check(openedTags.join(',') === '1,2,3', 'Genre/mood links did not open their individual tags')
    const metrics = host.querySelectorAll('.audio-visualizer-metrics > div')
    check(metrics[0].textContent === 'DYNAMIC3.0dB' && metrics[1].textContent === 'LEVEL-9.0dBFS', 'Dynamic reference or RMS level has the wrong value or unit')
    check(metrics.length === 3 && !host.innerText.includes('BIT DEPTH'), 'Metrics did not return to three columns')
    check(!host.querySelector('.audio-visualizer-metrics [title]'), 'Metric explanations still appear on hover')
    const widths = Array.from(metrics, element => element.getBoundingClientRect().width)
    check(Math.max(...widths) - Math.min(...widths) < 1, 'Metric columns have different widths')
    const metricsRect = host.querySelector('.audio-visualizer-metrics')!.getBoundingClientRect()
    check(Math.abs(metrics[0].getBoundingClientRect().left - metricsRect.left) < 1 && Math.abs(metrics[2].getBoundingClientRect().right - metricsRect.right) < 1, 'Metric columns do not span the full width')
    const canvases = Array.from(host.querySelectorAll('canvas'))
    check(canvases.length === 2 && canvases.every(canvas => canvas.width > 0 && canvas.height > 0), 'Visualization canvases have no dimensions')
    const waveformButton = host.querySelector<HTMLButtonElement>('.audio-visualizer-waveform')!
    const rect = waveformButton.getBoundingClientRect()
    waveformButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: rect.left + rect.width / 2 }))
    check(Math.abs(seek.at(-1)! - 90) < 0.01, 'Waveform click did not seek to the matching position')
    waveformButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    check(seek.at(-1) === 47, 'Waveform keyboard navigation failed')
    flushSync(() => root.render(<AudioVisualizer {...props} isPlaying={false} isAdvancing={false} />))
    await delay(1400)
    const readsWhenPaused = reads
    await delay(200)
    check(reads === readsWhenPaused && host.innerText.includes('PAUSED'), 'Paused visualization kept an animation loop alive')
    check(metrics[0].textContent === 'DYNAMIC—dB', 'Silence displayed a misleading dynamic ratio')
    check(getComputedStyle(status).color !== getComputedStyle(heading).color, 'Paused status remained highlighted')
    check(formatRequests.length === 1, 'Pause or progress caused a repeated source format read')
    flushSync(() => root.render(<AudioVisualizer {...props} trackKey="test:2" mediaUrl="venas-media://music/test2.flac" />))
    check(metrics[2].textContent === 'SAMPLE RATE—kHz', 'Previous track sample rate flashed on the next track')
    flushSync(() => root.render(<AudioVisualizer {...props} trackKey="test:3" mediaUrl="venas-media://music/test3.mp3" />))
    formatRequests[2].resolve({ sampleRate: 48000 })
    await delay(50)
    formatRequests[1].resolve({ sampleRate: 96000 })
    await delay(50)
    check(metrics[2].textContent === 'SAMPLE RATE48.0kHz', 'Late metadata overwrote current track sample rate')
    flushSync(() => root.render(<AudioVisualizer {...props} genre={[]} mood={undefined} active={false} />))
    check(!host.querySelector('.audio-visualizer-tag-link') && host.querySelector('.audio-visualizer-tags')!.textContent === 'GENRE—MOOD—', 'Empty metadata rendered navigable placeholders')
    const readsWhenClosed = reads
    await delay(150)
    check(reads === readsWhenClosed && releases >= 2, 'Closed visualization kept reading or leaked analysis')
    results.push('Visualization renders real metrics, seeks accurately, hides BPM, and stops after pause/close')
    results.push('Each Genre/Mood tag opens individually; empty values remain noninteractive')
  } finally { root.unmount(); host.remove(); unregister() }
  return results
}

export const result = run()
