import { adjacentTrackIndex, usePlayerStore, type PlayerState, type PlayerTrack } from '../stores/playerStore'
import { ListeningProgress, StreamListeningClock } from './listeningProgress'
import { registerAudioVisualization, waveformPeaks, type AudioVisualizationFrame } from './audioVisualization'

const PCM_BUDGET = 256 * 1024 * 1024
const FILE_BUDGET = 128 * 1024 * 1024
const START_LEAD = 0.03
const CLICK_FADE_SECONDS = 0.008

interface BufferSlot {
  track: PlayerTrack
  buffer: AudioBuffer
  source: AudioBufferSourceNode
  gain: GainNode
  start: number
  offset: number
  end: number
  accountedUntil: number
  pausedOffset?: number
}

function identity(track: PlayerTrack): string {
  return `${track.key}:${track.contentVersion ?? ''}`
}

function sourceIdentity(track: PlayerTrack): string {
  return `${identity(track)}:${track.mediaUrl}`
}

function bytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
}

function currentTrack(state: PlayerState): PlayerTrack | null {
  return state.currentIndex == null ? null : state.queue[state.currentIndex] ?? null
}

function offsetFor(state: PlayerState, track: PlayerTrack): number {
  const time = state.seekRequest?.trackKey === track.key ? state.seekRequest.time : state.currentTime
  return Number.isFinite(time) ? Math.max(0, time) : 0
}

/*
 * 声音由同一 AudioContext 排程。定时器只确认曲目边界和刷新界面，绝不负责启动已准备好的下一首。
 * 每次跳转/换队列都作废旧请求；decodeAudioData 无法取消，因此串行解码并丢弃过期结果。
 */
export class PlaybackEngine {
  private context: AudioContext | null = null
  private outputGain: GainNode | null = null
  private active: BufferSlot | null = null
  private next: BufferSlot | null = null
  private selected: PlayerTrack | null = null
  private audio: HTMLAudioElement | null = null
  private streamSource: MediaElementAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private analysisInput: AudioNode | null = null
  private analysisFrequencies = new Float32Array(0)
  private analysisSamples = new Float32Array(0)
  private waveforms = new WeakMap<AudioBuffer, Float32Array<ArrayBuffer>>()
  private streamWaveform: Float32Array<ArrayBuffer> | null = null
  private releaseVisualization: () => void
  private listening = new ListeningProgress()
  private heardRecorded = false
  private playbackRun = -1
  private streamClock = new StreamListeningClock()
  private streamAdvancing = false
  private loadAbort: AbortController | null = null
  private nextAbort: AbortController | null = null
  private nextDecode: Promise<AudioBuffer> | null = null
  private nextIdentity: string | null = null
  private generation = 0
  private decoding: Promise<unknown> = Promise.resolve()
  private publishing = false
  private disposed = false
  private maintaining = false
  private systemSuspended = false
  private audioFadeTimer: ReturnType<typeof setTimeout> | null = null
  private audioFadeGeneration = 0
  private audioVolumeMultiplier = 1
  private retiringSlots = new Set<BufferSlot>()
  private pausedNext: { identity: string; buffer: AudioBuffer } | null = null
  // 仅保留休眠前已经解码的当前/下一首；AudioBuffer 可用于新的 AudioContext，无需复制 PCM。
  private sleepBuffers = new Map<string, AudioBuffer>()
  private unsubscribe: () => void
  private timer: ReturnType<typeof setInterval>

  constructor(maintaining = false, systemSuspended = false) {
    this.maintaining = maintaining
    this.systemSuspended = systemSuspended
    this.unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (this.publishing || this.disposed) return
      if (state.volume !== previous.volume || state.muted !== previous.muted) this.applyVolume()
      if (state.queue !== previous.queue || state.currentIndex !== previous.currentIndex || state.seekRequest !== previous.seekRequest || state.isPlaying !== previous.isPlaying || state.playbackMode !== previous.playbackMode || state.shuffleOrder !== previous.shuffleOrder || state.nextShuffleOrder !== previous.nextShuffleOrder || state.gaplessEnabled !== previous.gaplessEnabled) {
        this.sync(state, previous)
      }
    })
    this.timer = setInterval(() => this.tick(), 100)
    this.releaseVisualization = registerAudioVisualization({ read: () => this.readVisualization(), release: () => this.stopVisualization() })
    this.sync(usePlayerStore.getState())
  }

  private readVisualization(): AudioVisualizationFrame | null {
    if (this.disposed || this.systemSuspended || this.maintaining || !this.selected || (!this.active && !this.audio)) return null
    try {
      const context = this.ensureContext()
      if (this.audio && !this.streamSource) {
        this.streamSource = context.createMediaElementSource(this.audio)
        this.streamSource.connect(context.destination)
        this.applyPlaying()
      }
      const input = this.streamSource ?? this.outputGain!
      if (!this.analyser || this.analysisInput !== input) {
        this.stopVisualization()
        this.analyser = context.createAnalyser()
        this.analyser.fftSize = 8192
        this.analyser.smoothingTimeConstant = 0.72
        this.analysisFrequencies = new Float32Array(this.analyser.frequencyBinCount)
        this.analysisSamples = new Float32Array(this.analyser.fftSize)
        this.analysisInput = input
        input.connect(this.analyser)
      }
      this.analyser.getFloatFrequencyData(this.analysisFrequencies)
      this.analyser.getFloatTimeDomainData(this.analysisSamples)
      let waveform: Float32Array<ArrayBuffer>
      if (this.active) {
        const buffer = this.active.buffer
        waveform = this.waveforms.get(buffer) ?? waveformPeaks(buffer)
        this.waveforms.set(buffer, waveform)
      } else {
        waveform = this.streamWaveform ??= new Float32Array(640).fill(-1)
        if (this.audio && this.streamAdvancing && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
          const bin = Math.min(waveform.length - 1, Math.floor(this.audio.currentTime / this.audio.duration * waveform.length))
          let peak = 0
          for (const sample of this.analysisSamples) peak = Math.max(peak, Math.abs(sample))
          waveform[bin] = Math.max(0, waveform[bin], peak)
        }
      }
      return { trackKey: this.selected.key, contentVersion: this.selected.contentVersion, sampleRate: context.sampleRate, fftSize: this.analyser.fftSize,
        frequencies: this.analysisFrequencies, samples: this.analysisSamples, waveform, waveformComplete: this.active != null }
    } catch {
      /* 可视化不可用时保留原有播放，不把装饰层的错误变成播放错误。 */
      this.stopVisualization()
      return null
    }
  }

  private stopVisualization(): void {
    if (this.analysisInput && this.analyser) this.analysisInput.disconnect(this.analyser)
    this.analyser?.disconnect()
    this.analysisInput = null
    this.analyser = null
    this.analysisFrequencies = new Float32Array(0)
    this.analysisSamples = new Float32Array(0)
  }

  private publish(data: Partial<PlayerState>): void {
    const state = usePlayerStore.getState()
    if (Object.keys(data).every((key) => Object.is(state[key as keyof PlayerState], data[key as keyof PlayerState]))) return
    this.publishing = true
    try { usePlayerStore.setState(data) } finally { this.publishing = false }
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'playback' })
      this.outputGain = this.context.createGain()
      const { volume, muted } = usePlayerStore.getState()
      this.outputGain.gain.value = muted ? 0 : volume
      this.outputGain.connect(this.context.destination)
    }
    return this.context
  }

  /* 当前与已排程的下一首共用输出增益，调整音量不重启音源。 */
  private applyVolume(): void {
    const { volume, muted } = usePlayerStore.getState()
    if (this.audio) {
      this.audio.volume = volume * this.audioVolumeMultiplier
      this.audio.muted = muted
    }
    if (this.outputGain && this.context) {
      const gain = this.outputGain.gain
      const now = this.context.currentTime
      gain.cancelAndHoldAtTime(now)
      if (this.context.state === 'running') gain.linearRampToValueAtTime(muted ? 0 : volume, now + 0.02)
      else gain.setValueAtTime(muted ? 0 : volume, now)
    }
  }

  private sync(state: PlayerState, previous?: PlayerState): void {
    this.accountListening()
    if (this.maintaining && state.isPlaying) this.publish({ isPlaying: false })
    const track = currentTrack(state)
    if (!track) {
      this.sleepBuffers.clear()
      this.reset()
      this.selected = null
      this.publish({ backend: null, playbackError: null })
      return
    }
    /* 入库只改变库身份，已缓冲的音频可以继续播放。 */
    const promoted = this.selected && state.transientPlaybackSource?.trackKey === track.key && state.transientPlaybackSource.mediaUrl === this.selected.mediaUrl && track.contentVersion === this.selected.contentVersion
    const same = this.selected && (identity(this.selected) === identity(track) || promoted)
    if (!same || this.playbackRun !== state.playbackRun) this.beginListening(state.playbackRun)
    const seek = previous && state.seekRequest !== previous.seekRequest && state.seekRequest?.trackKey === track.key
    const backendChanged = previous && state.gaplessEnabled !== previous.gaplessEnabled
    if (same && seek && !backendChanged && this.audio && this.audio.readyState >= 1) {
      this.streamClock.reset()
      this.streamAdvancing = false
      const audio = this.audio
      const target = Math.min(offsetFor(state, track), Number.isFinite(audio.duration) ? audio.duration : Infinity)
      if (state.isPlaying && !audio.paused) {
        this.fadeAudio(0, () => {
          if (this.audio !== audio) return
          audio.currentTime = target
          this.selected = track
          this.publish({ currentTime: audio.currentTime, playbackError: null, isAdvancing: false })
          if (this.isPlaybackRequested()) this.fadeAudio(1)
        })
      } else {
        audio.currentTime = target
        this.selected = track
        this.publish({ currentTime: audio.currentTime, playbackError: null, isAdvancing: false })
        this.applyPlaying()
      }
      return
    }
    if (!same || seek || backendChanged) {
      const reuse = !backendChanged
        ? same ? this.active?.buffer : this.next && identity(this.next.track) === identity(track) ? this.next.buffer
          : this.pausedNext?.identity === sourceIdentity(track) ? this.pausedNext.buffer : undefined
        : undefined
      const offset = backendChanged ? this.position() : offsetFor(state, track)
      this.loadCurrent(track, offset, reuse)
      return
    }
    this.selected = track
    if (this.active) this.active.track = track
    this.checkHeard()
    if (state.isPlaying && previous && !previous.isPlaying) this.publish({ playbackError: null })
    if (state.isPlaying && previous && !previous.isPlaying && this.active && this.position() >= this.active.buffer.duration) {
      this.loadCurrent(track, 0, this.active.buffer)
      return
    }
    this.applyPlaying()
    this.prepareNext()
  }

  private applyPlaying(): void {
    const playing = usePlayerStore.getState().isPlaying && !this.maintaining && !this.systemSuspended
    if (!playing) this.publish({ isAdvancing: false })
    if (this.audio) {
      if (playing) {
        this.fadeAudio(1)
        this.playStreamAudio()
      } else {
        this.streamAdvancing = false
        this.fadeAudio(0, () => {
          this.audio?.pause()
        })
      }
    }
    if (this.context && this.context.state !== 'closed') {
      const context = this.context
      const shouldRun = playing && (!this.audio || this.streamSource != null)
      if (!shouldRun) {
        this.pauseBuffered()
        return
      }
      this.resumeBuffered()
      if (context.state !== 'running') {
        void context.resume().then(() => {
          if (this.disposed || this.context !== context || !this.isPlaybackRequested()) return
          this.playStreamAudio()
        }).catch(() => {
          if (!this.disposed && this.context === context && usePlayerStore.getState().isPlaying) this.fail('无法启动音频输出，请重新点击播放。')
        })
      } else {
        this.playStreamAudio()
      }
    }
  }

  private isPlaybackRequested(): boolean {
    return usePlayerStore.getState().isPlaying && !this.maintaining && !this.systemSuspended
  }

  /* 暂停音源但保留静音的输出设备；重启设备会在部分耳机上产生瞬态。 */
  private pauseBuffered(): void {
    const slot = this.active
    if (!slot || slot.pausedOffset !== undefined) return
    const offset = this.position()
    slot.pausedOffset = offset
    this.stopSlot(slot)
    this.pausedNext = this.next ? { identity: sourceIdentity(this.next.track), buffer: this.next.buffer } : null
    this.cancelNext()
    this.publish({ currentTime: offset, isAdvancing: false })
  }

  private resumeBuffered(): void {
    const slot = this.active
    if (!slot || slot.pausedOffset === undefined) return
    this.active = this.makeSlot(slot.track, slot.buffer, this.ensureContext().currentTime + START_LEAD, slot.pausedOffset)
    this.prepareNext()
  }

  private fadeAudio(target: number, onComplete?: () => void): void {
    const audio = this.audio
    if (!audio) return
    const generation = ++this.audioFadeGeneration
    if (this.audioFadeTimer) clearTimeout(this.audioFadeTimer)
    const from = audio.volume / Math.max(usePlayerStore.getState().volume, 0.001)
    if (Math.abs(from - target) < 0.001) {
      this.audioFadeTimer = null
      this.audioVolumeMultiplier = target
      onComplete?.()
      return
    }
    const started = Date.now()
    const duration = CLICK_FADE_SECONDS * 1000
    const step = (): void => {
      if (generation !== this.audioFadeGeneration || this.audio !== audio) return
      const amount = Math.min(1, (Date.now() - started) / duration)
      const multiplier = from + (target - from) * amount
      this.audioVolumeMultiplier = multiplier
      const { volume, muted } = usePlayerStore.getState()
      audio.volume = volume * multiplier
      audio.muted = muted
      if (amount < 1) this.audioFadeTimer = setTimeout(step, 2)
      else {
        this.audioFadeTimer = null
        onComplete?.()
      }
    }
    this.audioFadeTimer = setTimeout(step, 2)
  }

  private playStreamAudio(): void {
    const audio = this.audio
    if (!audio || !this.isPlaybackRequested()) return
    void audio.play().catch((error: unknown) => {
      if (this.audio === audio && (error as DOMException)?.name !== 'AbortError') this.fail('音频无法播放，请检查文件或格式。')
    })
  }

  private position(): number {
    if (this.audio) return this.audio.currentTime
    if (this.active?.pausedOffset !== undefined) return this.active.pausedOffset
    if (this.active && this.context) return Math.max(this.active.offset, Math.min(this.active.buffer.duration, this.active.offset + this.context.currentTime - this.active.start))
    return usePlayerStore.getState().currentTime
  }

  private stopSlot(slot: BufferSlot | null): void {
    if (!slot) return
    if (this.retiringSlots.has(slot)) return
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      slot.source.onended = null
      try { slot.source.disconnect(); slot.gain.disconnect() } catch { /* 输出设备可能已关闭。 */ }
      this.retiringSlots.delete(slot)
    }
    const context = this.context
    if (context && context.currentTime >= slot.end) {
      // 自然播放完毕的 source 不会再发第二次 ended，立即释放，避免保留在退休集合中。
      release()
      return
    }
    if (context?.state === 'running') {
      const now = context.currentTime
      const stopAt = slot.start > now ? now : now + CLICK_FADE_SECONDS
      this.retiringSlots.add(slot)
      slot.source.onended = release
      slot.gain.gain.cancelAndHoldAtTime(now)
      if (slot.start > now) slot.gain.gain.setValueAtTime(0, now)
      else slot.gain.gain.linearRampToValueAtTime(0, stopAt)
      try { slot.source.stop(stopAt + (slot.start > now ? 0 : 0.001)) } catch { release() }
      // 尚未启动的下一首没有声音可淡出，立即断开，避免等到原定接缝才释放 PCM。
      if (slot.start > now) release()
    } else {
      try { slot.source.stop() } catch { /* 已结束的节点无需再次停止。 */ }
      release()
    }
  }

  private cancelNext(): void {
    this.nextAbort?.abort()
    this.nextAbort = null
    this.nextDecode = null
    this.nextIdentity = null
    this.stopSlot(this.next)
    this.next = null
  }

  private reset(): void {
    this.audioFadeGeneration++
    if (this.audioFadeTimer) clearTimeout(this.audioFadeTimer)
    this.audioFadeTimer = null
    this.stopVisualization()
    this.streamSource?.disconnect()
    this.streamSource = null
    this.streamWaveform = null
    this.streamClock.reset()
    this.streamAdvancing = false
    this.publish({ isAdvancing: false })
    this.generation += 1
    this.loadAbort?.abort()
    this.loadAbort = null
    this.cancelNext()
    this.pausedNext = null
    this.stopSlot(this.active)
    this.active = null
    if (this.audio) {
      const audio = this.audio
      this.audio = null
      audio.onended = audio.onerror = audio.onloadedmetadata = audio.ontimeupdate = audio.onseeked = audio.onplaying = audio.onwaiting = audio.onseeking = audio.onpause = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }

  private loadCurrent(track: PlayerTrack, offset: number, reuse?: AudioBuffer): void {
    if (!this.systemSuspended && !this.maintaining && usePlayerStore.getState().gaplessEnabled) {
      reuse ??= this.sleepBuffers.get(sourceIdentity(track))
      this.sleepBuffers.delete(sourceIdentity(track))
      // 当前曲目已改变时释放旧缓冲，避免它们与新的解码一起超出原有内存预算。
      if (!reuse) this.sleepBuffers.clear()
    }
    /* 手动切到正在预解码的下一首时，将任务转交给当前曲目，避免取消后串行重做整次读取/解码。 */
    const pending = !reuse && usePlayerStore.getState().gaplessEnabled
      && this.nextIdentity === sourceIdentity(track) && this.nextDecode && this.nextAbort
      ? { result: this.nextDecode, abort: this.nextAbort } : null
    if (pending) {
      this.nextAbort = null
      this.nextDecode = null
    }
    // 替换音源时让输出时钟继续运行，旧音源能在音频时钟上完整淡出。
    this.reset()
    this.selected = track
    const generation = this.generation
    this.publish({ currentTime: offset, duration: reuse?.duration ?? 0, playbackError: null, backend: null })
    if (this.maintaining || this.systemSuspended) { pending?.abort.abort(); return }
    if (!usePlayerStore.getState().gaplessEnabled) {
      this.sleepBuffers.clear()
      this.startStream(track, offset)
      return
    }
    try { this.ensureContext() } catch { this.sleepBuffers.clear(); this.startStream(track, offset); return }
    this.applyPlaying()
    if (reuse) {
      this.startBuffer(track, reuse, offset)
      return
    }
    const abort = pending?.abort ?? new AbortController()
    this.loadAbort = abort
    void (pending?.result ?? this.decode(track, abort.signal, 0)).then((buffer) => {
      if (this.disposed || abort.signal.aborted || generation !== this.generation) return
      this.loadAbort = null
      /* 加载期间可能已入库或改名，以最新身份发布进度。 */
      this.startBuffer(this.selected ?? track, buffer, offset)
    }).catch(() => {
      if (!this.disposed && !abort.signal.aborted && generation === this.generation) {
        this.loadAbort = null
        this.startStream(this.selected ?? track, offset)
      }
    })
  }

  private decode(track: PlayerTrack, signal: AbortSignal, retainedBytes: number): Promise<AudioBuffer> {
    const operation = this.decoding.catch(() => undefined).then(async () => {
      signal.throwIfAborted()
      const info = await window.api.playback.inspectFile(track.mediaUrl)
      signal.throwIfAborted()
      const context = this.ensureContext()
      if (!info.duration || !info.channels || !info.sampleRate || !Number.isFinite(info.duration) || info.duration <= 0 || info.channels <= 0 || info.size > FILE_BUDGET) throw new Error('Use streaming')
      /* 以较高的采样率保守估算保留 PCM；解码器临时内存不计入此预算。 */
      const estimate = Math.ceil(info.duration * Math.max(context.sampleRate, info.sampleRate)) * info.channels * 4
      if (estimate + retainedBytes > PCM_BUDGET) throw new Error('Use streaming')
      const url = new URL(track.mediaUrl)
      url.searchParams.set('revision', info.version)
      const response = await fetch(url.href, { signal, cache: 'no-store' })
      if (!response.ok || Number(response.headers.get('Content-Length')) > FILE_BUDGET) throw new Error('Audio unavailable')
      const encoded = await response.arrayBuffer()
      signal.throwIfAborted()
      if (encoded.byteLength > FILE_BUDGET || encoded.byteLength !== info.size) throw new Error('Audio changed')
      const buffer = await context.decodeAudioData(encoded)
      signal.throwIfAborted()
      if (bytes(buffer) + retainedBytes > PCM_BUDGET) throw new Error('Use streaming')
      return buffer
    })
    /* 队列尾不持有上次解码的 AudioBuffer，避免已播放曲目的缓冲被意外保留。 */
    this.decoding = operation.then(() => undefined, () => undefined)
    return operation
  }

  private makeSlot(track: PlayerTrack, buffer: AudioBuffer, start: number, offset = 0): BufferSlot {
    const context = this.ensureContext()
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(1, start + CLICK_FADE_SECONDS)
    source.connect(gain)
    gain.connect(this.outputGain!)
    const slot = { track, buffer, source, gain, start, offset, end: start + (buffer.length / buffer.sampleRate - offset), accountedUntil: start }
    source.onended = () => {
      if (this.active === slot) this.completeBuffer(slot)
    }
    source.start(start, offset)
    return slot
  }

  private startBuffer(track: PlayerTrack, buffer: AudioBuffer, requestedOffset: number): void {
    const offset = Math.min(requestedOffset, buffer.duration)
    this.active = this.makeSlot(track, buffer, this.ensureContext().currentTime + START_LEAD, offset)
    this.publish({ currentTime: offset, duration: buffer.duration, backend: 'web-audio' })
    if (this.isPlaybackRequested()) {
      this.applyPlaying()
      this.prepareNext()
    } else {
      this.pauseBuffered()
    }
  }

  private prepareNext(): void {
    if (!this.active || this.active.pausedOffset !== undefined || !this.isPlaybackRequested() || !usePlayerStore.getState().gaplessEnabled) return
    usePlayerStore.getState().prepareShuffleRound()
    const state = usePlayerStore.getState()
    const index = adjacentTrackIndex(state)
    const track = index == null ? null : state.queue[index]
    const nextIdentity = track ? sourceIdentity(track) : null
    if (nextIdentity === this.nextIdentity) return
    this.cancelNext()
    if (!track) { this.sleepBuffers.clear(); return }
    this.nextIdentity = nextIdentity
    const active = this.active
    const buffered = this.pausedNext?.identity === nextIdentity ? this.pausedNext.buffer : this.sleepBuffers.get(nextIdentity!)
    this.pausedNext = null
    this.sleepBuffers.clear()
    if (buffered) {
      this.next = this.makeSlot(track, buffered, active.end)
      return
    }
    const abort = new AbortController()
    this.nextAbort = abort
    const decoding = this.decode(track, abort.signal, bytes(active.buffer))
    this.nextDecode = decoding
    void decoding.then((buffer) => {
      if (this.disposed || abort.signal.aborted || this.active !== active || this.maintaining) return
      this.nextAbort = null
      /* 过了接缝再启动会截掉下一首开头，改由正常切歌完整播放。 */
      if (this.ensureContext().currentTime >= active.end) return
      this.next = this.makeSlot(track, buffer, active.end)
    }).catch(() => {
      /* 下一首无法预解码时不打断当前曲目，到边界后再按流式方案尝试。 */
    })
  }

  private beginListening(run: number): void {
    this.listening = new ListeningProgress()
    this.heardRecorded = false
    this.playbackRun = run
    this.streamClock.reset()
  }

  private checkHeard(): void {
    const duration = this.active?.buffer.duration ?? this.audio?.duration ?? 0
    if (!this.heardRecorded && this.selected?.songId != null && this.listening.reached(duration)) {
      this.heardRecorded = true
      usePlayerStore.getState().recordHeard(this.selected.songId)
    }
  }

  /* 暂停以 pausedOffset 冻结进度；只结算音源实际播放区间，不使用进度百分比。 */
  private accountListening(): void {
    if (this.systemSuspended) return
    if (this.active && this.context && this.active.pausedOffset === undefined) {
      const until = Math.max(this.active.start, Math.min(this.context.currentTime, this.active.end))
      this.listening.add(until - this.active.accountedUntil)
      this.active.accountedUntil = until
    } else if (this.audio) {
      this.listening.add(this.streamClock.sample(performance.now() / 1000, this.audio.currentTime, this.streamAdvancing))
    }
    this.checkHeard()
  }

  private completeBuffer(slot: BufferSlot): void {
    if (this.active !== slot || this.maintaining || !usePlayerStore.getState().isPlaying) return
    this.accountListening()
    const update = usePlayerStore.getState().advanceOrder()
    const state = usePlayerStore.getState()
    const index = update.currentIndex
    if (this.next && index != null && identity(state.queue[index]) === identity(this.next.track)) {
      const next = this.next
      this.stopSlot(slot)
      this.active = next
      this.next = null
      this.nextIdentity = null
      this.selected = state.queue[index]
      next.track = this.selected
      this.beginListening(update.playbackRun!)
      this.publish({ ...update, currentTime: this.position(), duration: next.buffer.duration, seekRequest: null, transientPlaybackSource: null })
      this.accountListening()
      this.prepareNext()
      /* 极短曲目在主线程恢复之前可能已经结束；仍按音频时钟补齐状态。 */
      if (this.context && this.context.currentTime >= next.end) this.completeBuffer(next)
    } else {
      this.advance(update)
    }
  }

  private advance(update = usePlayerStore.getState().advanceOrder()): void {
    const state = usePlayerStore.getState()
    const index = update.currentIndex
    if (index == null) {
      this.publish({ isPlaying: false, currentTime: state.duration })
      this.applyPlaying()
      return
    }
    this.beginListening(update.playbackRun!)
    this.publish({ ...update, currentTime: 0, duration: 0, seekRequest: null, transientPlaybackSource: null })
    this.loadCurrent(state.queue[index], 0)
  }

  private startStream(track: PlayerTrack, offset: number): void {
    if (this.disposed) return
    const audio = new Audio()
    this.audio = audio
    this.applyVolume()
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    this.audioVolumeMultiplier = 0
    audio.volume = 0
    audio.onloadedmetadata = () => {
      if (this.audio !== audio) return
      audio.currentTime = Math.min(offset, Number.isFinite(audio.duration) ? audio.duration : offset)
      this.publish({ currentTime: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
      this.applyPlaying()
    }
    audio.ontimeupdate = () => this.tick()
    const startProgress = (): void => {
      if (this.audio !== audio) return
      this.streamAdvancing = !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      this.streamClock.reset()
      this.tick()
    }
    audio.onplaying = audio.onseeked = startProgress
    const stopProgress = (): void => {
      if (this.audio !== audio) return
      this.accountListening()
      this.streamAdvancing = false
      this.streamClock.reset()
      this.publish({ currentTime: audio.currentTime, isAdvancing: false })
    }
    audio.onseeking = stopProgress
    audio.onwaiting = audio.onpause = stopProgress
    audio.onended = () => {
      if (this.audio !== audio || this.maintaining || !usePlayerStore.getState().isPlaying) return
      this.accountListening()
      this.advance()
    }
    audio.onerror = () => { if (this.audio === audio) this.fail('音频无法播放，请检查文件是否存在、格式是否受支持。') }
    audio.src = track.mediaUrl
    this.publish({ backend: 'stream' })
    this.applyPlaying()
  }

  private tick(): void {
    if (this.disposed || this.systemSuspended) return
    this.accountListening()
    if (this.active && this.context && this.context.currentTime >= this.active.end && usePlayerStore.getState().isPlaying) this.completeBuffer(this.active)
    const time = this.position()
    const playing = usePlayerStore.getState().isPlaying && !this.maintaining
    if (this.active) {
      const isAdvancing = playing && this.active.pausedOffset === undefined && this.context?.state === 'running' && this.context.currentTime >= this.active.start && this.context.currentTime < this.active.end
      this.publish({ currentTime: time, duration: this.active.buffer.duration, isAdvancing })
    } else if (this.audio && this.audio.readyState >= 1) {
      const isAdvancing = playing && !this.audio.paused && !this.audio.ended && !this.audio.seeking && this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      if (isAdvancing && !this.streamAdvancing) {
        this.streamAdvancing = true
        this.streamClock.reset()
        this.streamClock.sample(performance.now() / 1000, this.audio.currentTime, true)
      } else if (!isAdvancing) {
        this.streamAdvancing = false
      }
      this.publish({ currentTime: time, duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0, isAdvancing })
    }
  }

  setMaintenance(active: boolean): void {
    this.accountListening()
    this.maintaining = active
    if (active) {
      this.sleepBuffers.clear()
      this.cancelNext()
      this.loadAbort?.abort()
      this.publish({ isPlaying: false })
    }
    this.applyPlaying()
    if (!active) {
      if (!this.active && !this.audio && this.selected) this.loadCurrent(this.selected, usePlayerStore.getState().currentTime)
      else this.prepareNext()
    }
  }

  /* 系统休眠会使音频设备/旧时钟失效，resume() 不保证能修复原有输出。
   * 休眠前冻结实际进度，唤醒后用新输出恢复；isPlaying 始终保留用户的最新意图。
   */
  setSystemSuspended(suspended: boolean): void {
    if (this.disposed || (suspended && this.systemSuspended)) return
    if (suspended) {
      this.accountListening()
      this.publish({ currentTime: this.position() })
    }
    if (!this.systemSuspended) {
      this.sleepBuffers.clear()
      for (const slot of [this.active, this.next]) {
        if (slot) this.sleepBuffers.set(sourceIdentity(slot.track), slot.buffer)
      }
    }
    // 唤醒事件也可能在渲染进程错过 suspend 后到达，此时用最后发布的进度，
    // 不读取可能已经跳过整段休眠时间的旧音频时钟。
    this.systemSuspended = suspended
    const state = usePlayerStore.getState()
    const offset = state.currentTime
    this.reset()
    this.closeOutput()
    this.publish({ backend: null })
    if (!suspended) {
      const track = currentTrack(state)
      if (track) this.loadCurrent(track, offset)
    }
  }

  private closeOutput(): void {
    this.stopVisualization()
    for (const slot of this.retiringSlots) {
      slot.source.onended = null
      try { slot.source.disconnect(); slot.gain.disconnect() } catch { /* 输出设备可能已关闭。 */ }
    }
    this.retiringSlots.clear()
    const context = this.context
    this.context = null
    this.outputGain?.disconnect()
    this.outputGain = null
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
    // 旧设备的 decodeAudioData 可能永远不再返回，不能让它阻塞新设备的解码队列。
    // reset() 已作废旧任务，迟到结果不会再建立音源。
    this.decoding = Promise.resolve()
  }

  private fail(message: string): void {
    this.accountListening()
    this.publish({ isPlaying: false, playbackError: message })
    this.applyPlaying()
  }

  dispose(): void {
    this.accountListening()
    this.disposed = true
    this.releaseVisualization()
    this.unsubscribe()
    clearInterval(this.timer)
    this.sleepBuffers.clear()
    this.reset()
    this.closeOutput()
  }
}
