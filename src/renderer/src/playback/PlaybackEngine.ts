import { adjacentTrackIndex, usePlayerStore, type PlayerState, type PlayerTrack } from '../stores/playerStore'

const PCM_BUDGET = 256 * 1024 * 1024
const FILE_BUDGET = 128 * 1024 * 1024
const START_LEAD = 0.03

interface BufferSlot {
  track: PlayerTrack
  buffer: AudioBuffer
  source: AudioBufferSourceNode
  start: number
  offset: number
  end: number
  touched: boolean
}

function identity(track: PlayerTrack): string {
  return `${track.key}:${track.contentVersion ?? ''}`
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
  private streamTouched = false
  private loadAbort: AbortController | null = null
  private nextAbort: AbortController | null = null
  private nextIdentity: string | null = null
  private generation = 0
  private decoding: Promise<unknown> = Promise.resolve()
  private publishing = false
  private disposed = false
  private maintaining = false
  private unsubscribe: () => void
  private timer: ReturnType<typeof setInterval>

  constructor(maintaining = false) {
    this.maintaining = maintaining
    this.unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (this.publishing || this.disposed) return
      if (state.volume !== previous.volume || state.muted !== previous.muted) this.applyVolume()
      if (state.queue !== previous.queue || state.currentIndex !== previous.currentIndex || state.seekRequest !== previous.seekRequest || state.isPlaying !== previous.isPlaying || state.playbackMode !== previous.playbackMode || state.shuffleOrder !== previous.shuffleOrder || state.gaplessEnabled !== previous.gaplessEnabled) {
        this.sync(state, previous)
      }
    })
    this.timer = setInterval(() => this.tick(), 100)
    this.sync(usePlayerStore.getState())
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
      this.audio.volume = volume
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
    if (this.maintaining && state.isPlaying) this.publish({ isPlaying: false })
    const track = currentTrack(state)
    if (!track) {
      this.reset()
      this.selected = null
      this.publish({ backend: null, playbackError: null })
      return
    }
    /* 入库只改变库身份，已缓冲的音频可以继续播放。 */
    const promoted = this.selected && state.transientPlaybackSource?.trackKey === track.key && state.transientPlaybackSource.mediaUrl === this.selected.mediaUrl && track.contentVersion === this.selected.contentVersion
    const same = this.selected && (identity(this.selected) === identity(track) || promoted)
    const seek = previous && state.seekRequest !== previous.seekRequest && state.seekRequest?.trackKey === track.key
    const backendChanged = previous && state.gaplessEnabled !== previous.gaplessEnabled
    if (same && seek && !backendChanged && this.audio && this.audio.readyState >= 1) {
      this.audio.currentTime = Math.min(offsetFor(state, track), Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity)
      this.selected = track
      this.publish({ currentTime: this.audio.currentTime, playbackError: null, isAdvancing: false })
      this.applyPlaying()
      return
    }
    if (!same || seek || backendChanged) {
      const reuse = !backendChanged
        ? same ? this.active?.buffer : this.next && identity(this.next.track) === identity(track) ? this.next.buffer : undefined
        : undefined
      const offset = backendChanged ? this.position() : offsetFor(state, track)
      this.loadCurrent(track, offset, reuse)
      return
    }
    this.selected = track
    if (this.active) this.active.track = track
    if (state.isPlaying && previous && !previous.isPlaying) this.publish({ playbackError: null })
    if (state.isPlaying && previous && !previous.isPlaying && this.active && this.position() >= this.active.buffer.duration) {
      this.loadCurrent(track, 0, this.active.buffer)
      return
    }
    this.applyPlaying()
    this.prepareNext()
  }

  private applyPlaying(): void {
    const playing = usePlayerStore.getState().isPlaying && !this.maintaining
    if (!playing) this.publish({ isAdvancing: false })
    if (this.audio) {
      const audio = this.audio
      if (playing) {
        void audio.play().catch((error: unknown) => {
          if (this.audio === audio && (error as DOMException)?.name !== 'AbortError') this.fail('音频无法播放，请检查文件或格式。')
        })
      } else audio.pause()
    }
    if (this.context && this.context.state !== 'closed') {
      const context = this.context
      const shouldRun = playing && !this.audio
      const operation = shouldRun ? context.resume() : context.suspend()
      void operation.catch(() => {
        if (shouldRun && !this.disposed && this.context === context && usePlayerStore.getState().isPlaying) this.fail('无法启动音频输出，请重新点击播放。')
      })
    }
  }

  private position(): number {
    if (this.audio) return this.audio.currentTime
    if (this.active && this.context) return Math.max(this.active.offset, Math.min(this.active.buffer.duration, this.active.offset + this.context.currentTime - this.active.start))
    return usePlayerStore.getState().currentTime
  }

  private stopSlot(slot: BufferSlot | null): void {
    if (!slot) return
    slot.source.onended = null
    try { slot.source.stop() } catch { /* 已结束的节点无需再次停止。 */ }
    slot.source.disconnect()
  }

  private cancelNext(): void {
    this.nextAbort?.abort()
    this.nextAbort = null
    this.nextIdentity = null
    this.stopSlot(this.next)
    this.next = null
  }

  private reset(): void {
    this.publish({ isAdvancing: false })
    this.generation += 1
    this.loadAbort?.abort()
    this.loadAbort = null
    this.cancelNext()
    this.stopSlot(this.active)
    this.active = null
    if (this.context?.state === 'running') void this.context.suspend().catch(() => undefined)
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
    this.reset()
    this.selected = track
    const generation = this.generation
    this.publish({ currentTime: offset, duration: reuse?.duration ?? 0, playbackError: null, backend: null })
    if (this.maintaining) return
    if (!usePlayerStore.getState().gaplessEnabled) {
      this.startStream(track, offset)
      return
    }
    try { this.ensureContext() } catch { this.startStream(track, offset); return }
    this.applyPlaying()
    if (reuse) {
      this.startBuffer(track, reuse, offset)
      return
    }
    const abort = new AbortController()
    this.loadAbort = abort
    void this.decode(track, abort.signal, 0).then((buffer) => {
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
    source.buffer = buffer
    source.connect(this.outputGain!)
    const slot = { track, buffer, source, start, offset, end: start + (buffer.length / buffer.sampleRate - offset), touched: false }
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
    this.applyPlaying()
    this.prepareNext()
  }

  private prepareNext(): void {
    if (!this.active || this.maintaining || !usePlayerStore.getState().gaplessEnabled) return
    const state = usePlayerStore.getState()
    const index = adjacentTrackIndex(state)
    const track = index == null || index === state.currentIndex ? null : state.queue[index]
    const nextIdentity = track ? `${identity(track)}:${track.mediaUrl}` : null
    if (nextIdentity === this.nextIdentity) return
    this.cancelNext()
    if (!track) return
    this.nextIdentity = nextIdentity
    const active = this.active
    const abort = new AbortController()
    this.nextAbort = abort
    void this.decode(track, abort.signal, bytes(active.buffer)).then((buffer) => {
      if (this.disposed || abort.signal.aborted || this.active !== active || this.maintaining) return
      this.nextAbort = null
      /* 过了接缝再启动会截掉下一首开头，改由正常切歌完整播放。 */
      if (this.ensureContext().currentTime >= active.end) return
      this.next = this.makeSlot(track, buffer, active.end)
    }).catch(() => {
      /* 下一首无法预解码时不打断当前曲目，到边界后再按流式方案尝试。 */
    })
  }

  private touch(track: PlayerTrack): void {
    if (track.songId != null) void window.api.playback.touchLastHeard(track.songId).catch(() => undefined)
  }

  private completeBuffer(slot: BufferSlot): void {
    if (this.active !== slot || this.maintaining || !usePlayerStore.getState().isPlaying) return
    if (!slot.touched) { this.touch(slot.track); slot.touched = true }
    const state = usePlayerStore.getState()
    const index = adjacentTrackIndex(state)
    if (this.next && index != null && identity(state.queue[index]) === identity(this.next.track)) {
      const next = this.next
      this.stopSlot(slot)
      this.active = next
      this.next = null
      this.nextIdentity = null
      this.selected = state.queue[index]
      next.track = this.selected
      this.publish({ currentIndex: index, currentTime: this.position(), duration: next.buffer.duration, seekRequest: null, transientPlaybackSource: null })
      this.prepareNext()
      /* 极短曲目在主线程恢复之前可能已经结束；仍按音频时钟补齐状态。 */
      if (this.context && this.context.currentTime >= next.end) this.completeBuffer(next)
    } else {
      this.advance()
    }
  }

  private advance(): void {
    const state = usePlayerStore.getState()
    const index = adjacentTrackIndex(state)
    if (index == null || index === state.currentIndex) {
      this.publish({ isPlaying: false, currentTime: state.duration })
      this.applyPlaying()
      return
    }
    this.publish({ currentIndex: index, currentTime: 0, duration: 0, seekRequest: null, transientPlaybackSource: null })
    this.loadCurrent(state.queue[index], 0)
  }

  private startStream(track: PlayerTrack, offset: number): void {
    if (this.disposed) return
    const audio = new Audio()
    this.audio = audio
    this.applyVolume()
    this.streamTouched = false
    audio.preload = 'auto'
    audio.onloadedmetadata = () => {
      if (this.audio !== audio) return
      audio.currentTime = Math.min(offset, Number.isFinite(audio.duration) ? audio.duration : offset)
      this.publish({ currentTime: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
      this.applyPlaying()
    }
    audio.ontimeupdate = audio.onseeked = () => this.tick()
    audio.onplaying = () => this.tick()
    const stopProgress = (): void => {
      if (this.audio === audio) this.publish({ currentTime: audio.currentTime, isAdvancing: false })
    }
    audio.onwaiting = audio.onseeking = audio.onpause = stopProgress
    audio.onended = () => {
      if (this.audio !== audio || this.maintaining || !usePlayerStore.getState().isPlaying) return
      if (!this.streamTouched) { this.touch(this.selected ?? track); this.streamTouched = true }
      this.advance()
    }
    audio.onerror = () => { if (this.audio === audio) this.fail('音频无法播放，请检查文件是否存在、格式是否受支持。') }
    audio.src = track.mediaUrl
    this.publish({ backend: 'stream' })
    this.applyPlaying()
  }

  private tick(): void {
    if (this.disposed) return
    if (this.active && this.context && this.context.currentTime >= this.active.end && usePlayerStore.getState().isPlaying) this.completeBuffer(this.active)
    const time = this.position()
    const playing = usePlayerStore.getState().isPlaying && !this.maintaining
    if (this.active) {
      if (!this.active.touched && time >= this.active.buffer.duration * 0.6) {
        this.active.touched = true
        this.touch(this.active.track)
      }
      const isAdvancing = playing && this.context?.state === 'running' && this.context.currentTime >= this.active.start && this.context.currentTime < this.active.end
      this.publish({ currentTime: time, duration: this.active.buffer.duration, isAdvancing })
    } else if (this.audio && this.audio.readyState >= 1) {
      if (!this.streamTouched && this.audio.duration > 0 && time >= this.audio.duration * 0.6 && this.selected) {
        this.streamTouched = true
        this.touch(this.selected)
      }
      const isAdvancing = playing && !this.audio.paused && !this.audio.ended && !this.audio.seeking && this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      this.publish({ currentTime: time, duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0, isAdvancing })
    }
  }

  setMaintenance(active: boolean): void {
    this.maintaining = active
    if (active) {
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

  private fail(message: string): void {
    this.publish({ isPlaying: false, playbackError: message })
    this.applyPlaying()
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    clearInterval(this.timer)
    this.reset()
    this.outputGain?.disconnect()
    this.outputGain = null
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
  }
}
