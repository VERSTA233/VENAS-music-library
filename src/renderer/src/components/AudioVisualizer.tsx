import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate } from 'motion/react'
import type { PlaybackAudioFormat, TagRow } from '../../../shared/types'
import { colors } from '../../../shared/colors'
import { observeAudioVisualization, readAudioVisualization, spectrumLevels, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, type AudioVisualizationFrame } from '../playback/audioVisualization'
import PlaybackFade from './PlaybackFade'

interface AudioVisualizerProps {
  trackKey: string
  mediaUrl: string
  contentVersion?: string
  genre?: Pick<TagRow, 'id' | 'name' | 'tag_type'>[]
  mood?: Pick<TagRow, 'id' | 'name' | 'tag_type'>[]
  onOpenTag: (tag: Pick<TagRow, 'id' | 'name' | 'tag_type'>) => void
  currentTime: number
  duration: number
  isPlaying: boolean
  isAdvancing: boolean
  active: boolean
  onSeek: (time: number) => void
}

/* 图形只读取播放引擎的旁路采样，逐帧数据不进入 React 或持久化状态。 */
export default function AudioVisualizer(props: AudioVisualizerProps): React.JSX.Element {
  const spectrumRef = useRef<HTMLCanvasElement>(null)
  const waveformRef = useRef<HTMLCanvasElement>(null)
  const [metrics, setMetrics] = useState({ key: '', dynamic: '—', level: '—' })
  const [fileFormat, setFileFormat] = useState<{ key: string; format: PlaybackAudioFormat } | null>(null)
  const formatKey = JSON.stringify([props.trackKey, props.mediaUrl, props.contentVersion])
  const format = fileFormat?.key === formatKey ? fileFormat.format : null
  const contentKey = JSON.stringify([props.trackKey, props.contentVersion])
  const sampleRateKey = JSON.stringify([contentKey, format?.sampleRate])
  const propsRef = useRef(props)
  const redrawRef = useRef<() => void>(() => {})
  useLayoutEffect(() => { propsRef.current = props })

  useEffect(() => {
    if (!props.active || !props.mediaUrl) return
    let cancelled = false
    void window.api.playback.formatInfo(props.mediaUrl).then((info) => {
      if (!cancelled) setFileFormat({ key: formatKey, format: info })
    }).catch(() => {
      if (!cancelled) setFileFormat(null)
    })
    return () => { cancelled = true }
  }, [props.active, props.mediaUrl, formatKey])

  useEffect(() => {
    if (!props.active) return
    const spectrumCanvas = spectrumRef.current, waveformCanvas = waveformRef.current
    const spectrum = spectrumCanvas?.getContext('2d'), wave = waveformCanvas?.getContext('2d')
    if (!spectrumCanvas || !waveformCanvas || !spectrum || !wave) return
    let animation = 0, previousDraw = 0, settleUntil = 0, previousMetrics = 0
    let release: (() => void) | null = null
    let data: AudioVisualizationFrame | null = null
    let waveform: Float32Array<ArrayBuffer> | null = null
    let waveformKey = props.trackKey, waveformVersion = props.contentVersion
    let waveformScale = 0
    let waveformPhase: 'waiting' | 'collapsing' | 'expanding' | 'ready' = 'waiting'
    let waveformAnimation: ReturnType<typeof animate> | null = null
    const targets = new Float32Array(96), levels = new Float32Array(96), peaks = new Float32Array(96)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sizes = new Map<HTMLCanvasElement, { width: number; height: number }>()

    function animateWaveform(target: 0 | 1): void {
      waveformAnimation?.stop()
      waveformPhase = target === 0 ? 'collapsing' : 'expanding'
      /* 从屏幕当前高度开始，切换中再次切歌也不会跳回完整高度。 */
      waveformAnimation = animate(waveformScale, target, {
        type: 'spring', bounce: 0, duration: target === 0 ? 0.18 : 0.32,
        onUpdate: value => { waveformScale = value },
        onComplete: () => {
          waveformScale = target
          waveformPhase = target === 0 ? 'waiting' : 'ready'
          if (target === 0) waveform = null
          wake()
        }
      })
    }

    function updateWaveform(): void {
      const state = propsRef.current
      if (waveformKey !== state.trackKey || waveformVersion !== state.contentVersion) {
        waveformKey = state.trackKey
        waveformVersion = state.contentVersion
        if (waveform && waveformScale > 0 && !reducedMotion.matches) animateWaveform(0)
        else {
          waveformAnimation?.stop()
          waveform = null
          waveformScale = 0
          waveformPhase = 'waiting'
        }
      }
      if (reducedMotion.matches && waveformPhase === 'collapsing') {
        waveformAnimation?.stop()
        waveform = null
        waveformScale = 0
        waveformPhase = 'waiting'
      }
      /* 流式波形只包含已采样片段（未知值为 -1），不等待不存在的整曲解码。 */
      const available = data && (data.waveformComplete || data.waveform.some(value => value >= 0))
      if (waveformPhase !== 'collapsing' && available) {
        waveform = data!.waveform
        if (reducedMotion.matches) {
          waveformAnimation?.stop()
          waveformScale = 1
          waveformPhase = 'ready'
        } else if (waveformPhase === 'waiting') animateWaveform(1)
      }
    }

    function measure(canvas: HTMLCanvasElement): void {
      const { width, height } = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      canvas.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0)
      sizes.set(canvas, { width, height })
    }

    function drawSpectrum(): void {
      const { width, height } = sizes.get(spectrumCanvas!)!
      const left = 27, right = Math.max(left + 1, width - 5), top = 27, bottom = Math.max(top + 1, height - 7)
      const plotWidth = right - left, plotHeight = bottom - top
      spectrum!.clearRect(0, 0, width, height)
      spectrum!.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
      spectrum!.lineWidth = 1
      const maxHz = Math.min(SPECTRUM_MAX_HZ, (data?.sampleRate ?? 48000) / 2)
      for (const hz of [30, 100, 1000, 5000, 20000]) {
        if (hz > maxHz) continue
        const x = left + Math.log(hz / SPECTRUM_MIN_HZ) / Math.log(maxHz / SPECTRUM_MIN_HZ) * plotWidth
        spectrum!.strokeStyle = colors['visualizer-grid']
        spectrum!.setLineDash([2, 4])
        spectrum!.beginPath(); spectrum!.moveTo(x + 0.5, top); spectrum!.lineTo(x + 0.5, bottom); spectrum!.stroke()
        spectrum!.fillStyle = colors['visualizer-label']
        spectrum!.textAlign = hz === 30 ? 'left' : hz === 20000 ? 'right' : 'center'
        spectrum!.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x, 12)
      }
      spectrum!.textAlign = 'left'
      for (const db of [0, -30, -60, -90]) {
        const y = top + -db / 90 * plotHeight
        spectrum!.strokeStyle = colors['visualizer-grid']
        spectrum!.beginPath(); spectrum!.moveTo(left, y + 0.5); spectrum!.lineTo(right, y + 0.5); spectrum!.stroke()
        spectrum!.fillStyle = colors['visualizer-label']
        spectrum!.fillText(String(db), 0, y + 3)
      }
      spectrum!.setLineDash([])
      const step = plotWidth / levels.length
      for (let index = 0; index < levels.length; index++) {
        const x = left + index * step
        const barHeight = Math.max(1, levels[index] * plotHeight)
        spectrum!.fillStyle = colors['visualizer-bar']
        spectrum!.fillRect(x, bottom - barHeight, Math.max(1, step - 1.4), barHeight)
        if (peaks[index] > 0.015) {
          spectrum!.fillStyle = colors['visualizer-peak']
          spectrum!.fillRect(x, bottom - peaks[index] * plotHeight, Math.max(1, step - 1.4), 1)
        }
      }
    }

    function drawWaveform(): void {
      const { width, height } = sizes.get(waveformCanvas!)!
      wave!.clearRect(0, 0, width, height)
      const state = propsRef.current
      const progress = state.duration > 0 ? Math.max(0, Math.min(1, state.currentTime / state.duration)) : 0
      const center = height / 2
      wave!.fillStyle = colors['visualizer-grid']
      wave!.fillRect(0, center, width, 1)
      if (waveform && waveformScale > 0) {
        const step = Math.max(1.5, width / 240)
        for (let x = 0; x < width; x += step) {
          const first = Math.floor(x / width * waveform.length)
          const end = Math.min(waveform.length, Math.max(first + 1, Math.ceil((x + step) / width * waveform.length)))
          let amplitude = -1
          for (let bin = first; bin < end; bin++) amplitude = Math.max(amplitude, waveform[bin])
          if (amplitude < 0) continue
          const barHeight = Math.max(1, Math.sqrt(amplitude) * (height - 8)) * waveformScale
          wave!.fillStyle = waveformPhase !== 'collapsing' && x / width <= progress ? colors['visualizer-waveform-played'] : colors['visualizer-waveform']
          wave!.fillRect(x, center - barHeight / 2, Math.max(1, step - 0.7), barHeight)
        }
      }
      wave!.fillStyle = colors['visualizer-accent']
      wave!.fillRect(Math.min(Math.max(0, width - 2), progress * width), 1, 2, height - 2)
    }

    function updateMetrics(timestamp: number, running: boolean): void {
      if (timestamp - previousMetrics < 400) return
      previousMetrics = timestamp
      let square = 0, peak = 0
      if (data && running) {
        for (const sample of data.samples) { square += sample * sample; peak = Math.max(peak, Math.abs(sample)) }
      }
      const rms = data?.samples.length ? Math.sqrt(square / data.samples.length) : 0
      const decibels = (value: number): string => value > 0.000032 ? (20 * Math.log10(value)).toFixed(1) : '−∞'
      // 峰均比提供实时动态参考；静音时比值无定义，不显示虚假的动态值。
      const key = JSON.stringify([propsRef.current.trackKey, propsRef.current.contentVersion])
      const dynamic = data && rms > 0.000032 ? (20 * Math.log10(peak / rms)).toFixed(1) : '—'
      const level = data ? decibels(rms) : '—'
      setMetrics(previous => previous.key === key && previous.dynamic === dynamic && previous.level === level
        ? previous : { key, dynamic, level })
    }

    function draw(timestamp: number): void {
      animation = 0
      const state = propsRef.current
      const running = state.isPlaying && state.isAdvancing
      if (document.hidden) return
      const interval = reducedMotion.matches ? 100 : 1000 / 30
      if (timestamp - previousDraw >= interval) {
        const elapsed = Math.min(0.1, Math.max(0.001, (timestamp - previousDraw) / 1000))
        previousDraw = timestamp
        const frame = readAudioVisualization()
        if (frame?.trackKey === state.trackKey && frame?.contentVersion === state.contentVersion) data = frame
        else data = null
        updateWaveform()
        if (data && running) spectrumLevels(data.frequencies, data.sampleRate, data.fftSize, targets)
        else targets.fill(0)
        for (let index = 0; index < levels.length; index++) {
          const response = reducedMotion.matches ? 0.5 : targets[index] > levels[index] ? 0.045 : 0.2
          levels[index] += (targets[index] - levels[index]) * (1 - Math.exp(-elapsed / response))
          peaks[index] = Math.max(levels[index], peaks[index] - elapsed * (running ? 0.16 : 1))
        }
        drawSpectrum()
        drawWaveform()
        updateMetrics(timestamp, running)
      }
      if (running || waveformPhase === 'collapsing' || waveformPhase === 'expanding' || timestamp < settleUntil) animation = requestAnimationFrame(draw)
    }

    function wake(): void {
      if (document.hidden) return
      settleUntil = performance.now() + 1200
      if (!animation) animation = requestAnimationFrame(draw)
    }
    function visibility(): void {
      cancelAnimationFrame(animation)
      animation = 0
      if (document.hidden) { release?.(); release = null }
      else { release ??= observeAudioVisualization(); wake() }
    }
    redrawRef.current = wake
    const resize = new ResizeObserver(() => { measure(spectrumCanvas!); measure(waveformCanvas!); wake() })
    resize.observe(spectrumCanvas)
    resize.observe(waveformCanvas)
    measure(spectrumCanvas); measure(waveformCanvas)
    document.addEventListener('visibilitychange', visibility)
    reducedMotion.addEventListener('change', wake)
    visibility()
    return () => {
      redrawRef.current = () => {}
      waveformAnimation?.stop()
      cancelAnimationFrame(animation)
      resize.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      reducedMotion.removeEventListener('change', wake)
      release?.()
    }
  }, [props.active])

  useEffect(() => { redrawRef.current() }, [props.trackKey, props.contentVersion, props.currentTime, props.duration, props.isPlaying, props.isAdvancing])

  const running = props.isPlaying && props.isAdvancing
  return (
    <section className="audio-visualizer" aria-label="音频可视化">
      <div className="audio-visualizer-tags">
        {([['GENRE', props.genre], ['MOOD', props.mood]] as const).map(([label, tags]) => (
          <div key={label}>
            <span className="audio-visualizer-caption">{label}</span>
            <PlaybackFade contentKey={JSON.stringify([contentKey, tags])} className="audio-visualizer-tag-value">
              {tags?.length ? tags.map((tag, index) => (
                <span key={tag.id}>
                  {index > 0 && ' / '}
                  <button type="button" className="audio-visualizer-tag-link" aria-label={`查看标签 ${tag.name}`} onClick={() => props.onOpenTag(tag)}>{tag.name}</button>
                </span>
              )) : '—'}
            </PlaybackFade>
          </div>
        ))}
      </div>
      <header className="audio-visualizer-header">
        <span className="audio-visualizer-title">SPECTRUM</span>
        <span className="audio-visualizer-status" data-running={running}>
          <i aria-hidden="true" />{running ? 'PLAYING' : props.isPlaying ? 'LOADING' : 'PAUSED'}
        </span>
      </header>
      <div className="audio-visualizer-spectrum"><canvas ref={spectrumRef} aria-label="实时对数频谱，横轴为频率，纵轴为分贝" /></div>
      <div className="audio-visualizer-timeline">
        <button type="button" className="audio-visualizer-waveform" aria-label="点击波形跳转播放位置"
          disabled={props.duration <= 0}
          onClick={event => {
            if (event.detail === 0) return
            const rect = event.currentTarget.getBoundingClientRect()
            props.onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * props.duration)
          }}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.duration : props.currentTime + (event.key === 'ArrowRight' ? 5 : -5)
            props.onSeek(Math.max(0, Math.min(props.duration, next)))
          }}>
          <canvas ref={waveformRef} aria-hidden="true" />
        </button>
      </div>
      <footer className="audio-visualizer-metrics">
        <div>
          <span className="audio-visualizer-caption">DYNAMIC</span>
          <PlaybackFade contentKey={contentKey} className="audio-visualizer-metric-value">
            <span>{metrics.key === contentKey ? metrics.dynamic : '—'}</span><small>dB</small>
          </PlaybackFade>
        </div>
        <div>
          <span className="audio-visualizer-caption">LEVEL</span>
          <PlaybackFade contentKey={contentKey} className="audio-visualizer-metric-value">
            <span>{metrics.key === contentKey ? metrics.level : '—'}</span><small>dBFS</small>
          </PlaybackFade>
        </div>
        <div>
          <span className="audio-visualizer-caption">SAMPLE RATE</span>
          <PlaybackFade contentKey={sampleRateKey} className="audio-visualizer-metric-value">
            <span>{format?.sampleRate ? (format.sampleRate / 1000).toFixed(1) : '—'}</span><small>kHz</small>
          </PlaybackFade>
        </div>
      </footer>
    </section>
  )
}
