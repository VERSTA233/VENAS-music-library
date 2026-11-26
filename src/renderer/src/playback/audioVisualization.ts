/* 可视化只旁路读取当前音源，不创建第二份播放或解码任务。 */
export interface AudioVisualizationFrame {
  trackKey: string
  contentVersion?: string
  sampleRate: number
  fftSize: number
  frequencies: Float32Array<ArrayBuffer>
  samples: Float32Array<ArrayBuffer>
  waveform: Float32Array<ArrayBuffer>
  waveformComplete: boolean
}

interface VisualizationSource {
  read: () => AudioVisualizationFrame | null
  release: () => void
}

let source: VisualizationSource | null = null
let observers = 0

export function registerAudioVisualization(next: VisualizationSource): () => void {
  source?.release()
  source = next
  return () => {
    next.release()
    if (source === next) source = null
  }
}

export function observeAudioVisualization(): () => void {
  observers++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--observers === 0) source?.release()
  }
}

export function readAudioVisualization(): AudioVisualizationFrame | null {
  return observers > 0 ? source?.read() ?? null : null
}

/* 固定大小的概览，限制采样量；不复制或持有整份 PCM。未知的流式区间用 -1 表示。 */
export function waveformPeaks(buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>, count = 640): Float32Array<ArrayBuffer> {
  const peaks = new Float32Array(count)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor(bin * buffer.length / count)
    const end = Math.floor((bin + 1) * buffer.length / count)
    const stride = Math.max(1, Math.floor((end - start) / 128))
    let peak = 0
    for (const channel of channels) {
      for (let sample = start; sample < end; sample += stride) peak = Math.max(peak, Math.abs(channel[sample]))
    }
    peaks[bin] = Math.min(1, peak)
  }
  return peaks
}

const SPECTRUM_MIN_DB = -90
const SPECTRUM_MAX_DB = 0
export const SPECTRUM_MIN_HZ = 30
export const SPECTRUM_MAX_HZ = 20000

/* 对数频率分组；低频小于一个 FFT bin 时插值，避免频谱在左侧形成台阶。 */
export function spectrumLevels(frequencies: Float32Array, sampleRate: number, fftSize: number, output: Float32Array): void {
  const maxHz = Math.min(SPECTRUM_MAX_HZ, sampleRate / 2)
  const ratio = maxHz / SPECTRUM_MIN_HZ
  const binHz = sampleRate / fftSize
  for (let bar = 0; bar < output.length; bar++) {
    const start = SPECTRUM_MIN_HZ * ratio ** (bar / output.length) / binHz
    const end = SPECTRUM_MIN_HZ * ratio ** ((bar + 1) / output.length) / binHz
    const midpoint = (start + end) / 2
    const left = Math.min(frequencies.length - 1, Math.floor(midpoint))
    const fraction = midpoint - Math.floor(midpoint)
    const a = Number.isFinite(frequencies[left]) ? frequencies[left] : SPECTRUM_MIN_DB
    const b = Number.isFinite(frequencies[Math.min(left + 1, frequencies.length - 1)]) ? frequencies[Math.min(left + 1, frequencies.length - 1)] : SPECTRUM_MIN_DB
    let db = a + (b - a) * fraction
    for (let bin = Math.ceil(start); bin < end && bin < frequencies.length; bin++) {
      if (Number.isFinite(frequencies[bin])) db = Math.max(db, frequencies[bin])
    }
    output[bar] = Math.max(0, Math.min(1, (db - SPECTRUM_MIN_DB) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB)))
  }
}
