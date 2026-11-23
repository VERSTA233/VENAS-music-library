import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { calendarDay, isPermutation, playbackWeight, weightedOrder } from '../src/renderer/src/playback/weightedShuffle'
import { ListeningProgress, StreamListeningClock } from '../src/renderer/src/playback/listeningProgress'
import { adjacentTrackIndex, ensurePlaybackHistory, usePlayerStore, type PlayerTrack } from '../src/renderer/src/stores/playerStore'
import { PlaybackEngine } from '../src/renderer/src/playback/PlaybackEngine'
import { configureAudioOutput } from '../src/main/audioOutput'

function seeded(seed = 42): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}

function track(id: number): PlayerTrack {
  return { key: `song:${id}`, title: String(id), artistNames: '', mediaUrl: `music://song/${id}`, songId: id, appendEntry: null }
}

const store = usePlayerStore
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const settleSeek = async (gapless: boolean): Promise<void> => {
  if (!gapless) await new Promise((resolve) => setTimeout(resolve, 20))
  await flush()
}
const reset = (): void => store.setState(store.getInitialState(), true)

test('macOS playback output preserves Chromium feature options, honors explicit disable and leaves other platforms alone', () => {
  const options = new Map([['enable-features', 'ExistingFeature:mode/value'], ['disable-features', 'AnotherFeature']])
  const commandLine = {
    getSwitchValue: (name: string) => options.get(name) ?? '',
    appendSwitch: (name: string, value: string) => { options.set(name, value) }
  }
  assert.deepEqual(configureAudioOutput(commandLine, 'win32'), { activeBackend: null, launchOverride: false })
  assert.equal(options.get('enable-features'), 'ExistingFeature:mode/value')
  assert.deepEqual(configureAudioOutput(commandLine, 'darwin'), { activeBackend: 'avfoundation', launchOverride: false })
  assert.deepEqual(configureAudioOutput(commandLine, 'darwin'), { activeBackend: 'avfoundation', launchOverride: true })
  assert.equal(options.get('enable-features'), 'ExistingFeature:mode/value,MacAVFoundationPlayback')
  assert.equal(options.get('disable-features'), 'AnotherFeature')
  options.set('enable-features', 'ExistingFeature')
  options.set('disable-features', 'MacAVFoundationPlayback')
  assert.deepEqual(configureAudioOutput(commandLine, 'darwin'), { activeBackend: 'auhal', launchOverride: true })
  assert.equal(options.get('enable-features'), 'ExistingFeature')
})

test('saved AUHAL choice disables AVFoundation at startup without overwriting unrelated feature switches', () => {
  const options = new Map([['enable-features', 'OtherPlaybackFeature'], ['disable-features', 'OtherDisabledFeature']])
  const commandLine = {
    getSwitchValue: (name: string) => options.get(name) ?? '',
    appendSwitch: (name: string, value: string) => { options.set(name, value) }
  }
  assert.deepEqual(configureAudioOutput(commandLine, 'darwin', 'auhal'), { activeBackend: 'auhal', launchOverride: false })
  assert.equal(options.get('enable-features'), 'OtherPlaybackFeature')
  assert.equal(options.get('disable-features'), 'OtherDisabledFeature,MacAVFoundationPlayback')
  options.set('enable-features', 'MacAVFoundationPlayback:mode/value')
  options.set('disable-features', 'OtherDisabledFeature')
  assert.deepEqual(configureAudioOutput(commandLine, 'darwin', 'auhal'), { activeBackend: 'avfoundation', launchOverride: true })
})

test('weights use calendar days, bounded formula, never-played fallback and future-date clamp', () => {
  const now = new Date(2026, 9, 29, 23, 59)
  assert.equal(playbackWeight('2026-10-29', now), 1)
  assert.equal(playbackWeight('2026-10-22', now), 2)
  assert.equal(playbackWeight('2026-10-15', now), 2.5)
  assert.equal(playbackWeight('2026-11-01', now), 1)
  for (const date of [null, undefined, '', '2026-02-30', 'bad']) assert.equal(playbackWeight(date, now), 4)
  assert.ok(playbackWeight('2000-01-01', now) < 4)
  assert.equal(calendarDay(new Date(2026, 2, 9)) - calendarDay(new Date(2026, 2, 8)), 1)
})

test('weighted permutations follow 1:2:4 probabilities and exclude previous last only at the head', () => {
  const random = seeded()
  const counts = [0, 0, 0]
  const second = [0, 0, 0]
  const iterations = 35000
  for (let i = 0; i < iterations; i++) {
    const order = weightedOrder([1, 2, 4], null, random)
    assert.ok(isPermutation(order, 3))
    counts[order[0]]++
    const constrained = weightedOrder([1, 2, 4], 2, random)
    assert.notEqual(constrained[0], 2)
    second[constrained[1]]++
  }
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(counts[i] / iterations - [1, 2, 4][i] / 7) < 0.015)
  // Given the first choice is restricted to 0/1, the excluded track still competes normally for second.
  assert.ok(Math.abs(second[2] / iterations - (1 / 3 * 4 / 6 + 2 / 3 * 4 / 5)) < 0.015)
  assert.deepEqual(weightedOrder([4], 0, random), [0])
  assert.deepEqual(weightedOrder([], null, random), [])
})

test('listening accumulates repeated passages; stream clock rejects seeks and paused wall time', () => {
  const progress = new ListeningProgress()
  const clock = new StreamListeningClock()
  progress.add(clock.sample(0, 0, true))
  progress.add(clock.sample(20, 20, true))
  progress.add(clock.sample(20.1, 90, true))
  assert.equal(progress.seconds, 20)
  clock.reset()
  progress.add(clock.sample(21, 0, true))
  progress.add(clock.sample(41, 20, false))
  progress.add(clock.sample(500, 20, true))
  progress.add(clock.sample(520, 40, true))
  assert.equal(progress.seconds, 60)
  assert.equal(progress.reached(100), true)
  assert.equal(progress.reached(0), false)
})

test('history loading is shared; later playback cancels an earlier asynchronous shuffle command', async () => {
  reset()
  let resolve!: (rows: { songId: number; date: string }[]) => void
  let reads = 0
  globalThis.window = { api: { playback: {
    lastHeardDates: () => { reads++; return new Promise((done) => { resolve = done }) }
  } } } as never
  store.getState().playRandomQueue([track(1), track(2)])
  const pending = ensurePlaybackHistory()
  store.getState().playQueue([track(3)], 0)
  resolve([])
  await pending
  await flush()
  assert.equal(reads, 1)
  assert.equal(store.getState().queue[0].songId, 3)
  assert.equal(store.getState().playbackMode, 'sequential')
})

test('shuffle rounds visit each entry once, maintain lookahead and return across the round boundary', async () => {
  reset()
  store.getState().playRandomQueue([track(1), track(2), track(3), track(4)])
  const first = [...store.getState().shuffleOrder]
  const visited: number[] = []
  for (let i = 0; i < 4; i++) {
    visited.push(store.getState().currentIndex!)
    if (i < 3) store.getState().playNext()
  }
  assert.deepEqual(visited, first)
  store.getState().prepareShuffleRound()
  const lookahead = store.getState().nextShuffleOrder
  assert.notEqual(lookahead[0], first.at(-1))
  store.getState().prepareShuffleRound()
  assert.equal(store.getState().nextShuffleOrder, lookahead)
  assert.equal(adjacentTrackIndex(store.getState()), lookahead[0])
  store.getState().playNext()
  assert.deepEqual(store.getState().shuffleOrder, lookahead)
  store.getState().playPrev()
  assert.equal(store.getState().currentIndex, first.at(-1))
  store.getState().playNext()
  assert.deepEqual(store.getState().shuffleOrder, lookahead)
  store.getState().removeSong(2)
  assert.ok(isPermutation(store.getState().shuffleOrder, 3))
  assert.equal(store.getState().nextShuffleOrder.length, 0)
})

test('restore retains shuffle rounds; old sessions with invalid orders recover safely', async () => {
  reset()
  const queue = [track(1), track(2), track(3)]
  store.getState().restoreSession({ queue, currentIndex: 0, currentTime: 42, playbackMode: 'shuffle',
    shuffleOrder: [0, 1, 2], nextShuffleOrder: [1, 2, 0], previousShuffleOrder: [2, 1, 0] })
  assert.equal(store.getState().isPlaying, false)
  assert.equal(store.getState().currentTime, 42)
  assert.deepEqual(store.getState().nextShuffleOrder, [1, 2, 0])
  store.getState().restoreSession({ queue: [...queue], currentIndex: 0, currentTime: 0, playbackMode: 'shuffle', shuffleOrder: [1, 1, 8] })
  assert.ok(isPermutation(store.getState().shuffleOrder, 3))
  assert.equal(store.getState().shuffleOrder[0], 0)
  await flush()
})

// The real engine runs against controlled audio clocks; no disk media, user database or elapsed-minute waits.
async function audioFixture(gapless: boolean, run: (f: {
  advance: (seconds: number, tick?: boolean) => void
  engine: PlaybackEngine
  contexts: FakeContext[]
  audios: FakeAudio[]
  heard: number[]
}) => Promise<void>): Promise<void> {
  reset()
  let wall = 0
  const contexts: FakeContext[] = []
  const audios: FakeAudio[] = []
  const heard: number[] = []
  const dates = new Date().toLocaleDateString('sv-SE')
  globalThis.window = { api: { playback: {
    lastHeardDates: async () => [],
    touchLastHeard: async (id: number) => { heard.push(id); return dates },
    inspectFile: async () => ({ duration: 100, channels: 1, sampleRate: 100, size: 8, version: 'test' })
  } } } as never
  await ensurePlaybackHistory()
  mock.method(performance, 'now', () => wall * 1000)
  mock.method(globalThis, 'setInterval', () => 0 as never)
  const savedContext = globalThis.AudioContext
  const savedAudio = globalThis.Audio
  const savedMedia = globalThis.HTMLMediaElement
  globalThis.AudioContext = class extends FakeContext { constructor() { super(); contexts.push(this) } } as never
  globalThis.Audio = class extends FakeAudio { constructor() { super(); audios.push(this) } } as never
  globalThis.HTMLMediaElement = { HAVE_FUTURE_DATA: 3 } as never
  mock.method(globalThis, 'fetch', async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(8) }) as Response)
  store.setState({ gaplessEnabled: gapless })
  const engine = new PlaybackEngine()
  try {
    await run({
      engine, contexts, audios, heard,
      advance: (seconds, tick = true) => {
        wall += seconds
        for (const context of contexts) if (context.state === 'running') context.currentTime += seconds
        for (const audio of audios) if (!audio.paused && audio.readyState >= 3 && !audio.seeking) audio.elapse(seconds)
        if (tick) (engine as any).tick()
      }
    })
  } finally {
    engine.dispose()
    mock.restoreAll()
    globalThis.AudioContext = savedContext
    globalThis.Audio = savedAudio
    globalThis.HTMLMediaElement = savedMedia
  }
}

class FakeContext {
  currentTime = 0
  sampleRate = 100
  state = 'suspended'
  decodes = 0
  suspends = 0
  sources: Array<{ onended: (() => void) | null; disconnected: boolean; stoppedAt: number | null }> = []
  destination = {}
  createGain(): any { return { gain: { value: 1, cancelAndHoldAtTime() {}, linearRampToValueAtTime() {}, setValueAtTime() {} }, connect() {}, disconnect() {} } }
  createBufferSource(): any {
    const source = { onended: null as (() => void) | null, disconnected: false, stoppedAt: null as number | null,
      connect() {}, disconnect() { source.disconnected = true }, start() {}, stop(at: number) { source.stoppedAt = at } }
    this.sources.push(source)
    return source
  }
  createMediaElementSource(): any { return { connect() {}, disconnect() {} } }
  async decodeAudioData(): Promise<any> { this.decodes++; return { duration: 100, length: 10000, sampleRate: 100, numberOfChannels: 1 } }
  async resume(): Promise<void> { this.state = 'running' }
  async suspend(): Promise<void> { this.suspends++; this.state = 'suspended' }
  async close(): Promise<void> { this.state = 'closed' }
}

class FakeAudio {
  private position = 0
  duration = 100
  volume = 1
  muted = false
  readyState = 0
  paused = true
  ended = false
  seeking = false
  onloadedmetadata: (() => void) | null = null
  onplaying: (() => void) | null = null
  onpause: (() => void) | null = null
  onwaiting: (() => void) | null = null
  onseeking: (() => void) | null = null
  onseeked: (() => void) | null = null
  onended: (() => void) | null = null
  get currentTime(): number { return this.position }
  set currentTime(value: number) {
    this.position = value
    this.seeking = true
    this.onseeking?.()
    queueMicrotask(() => { this.seeking = false; this.onseeked?.() })
  }
  set src(_value: string) { queueMicrotask(() => { this.readyState = 4; this.onloadedmetadata?.() }) }
  elapse(seconds: number): void { this.position = Math.min(this.duration, this.position + seconds) }
  async play(): Promise<void> {
    const wasPaused = this.paused
    this.paused = false
    if (wasPaused) queueMicrotask(() => this.onplaying?.())
  }
  pause(): void { this.paused = true; this.onpause?.() }
  removeAttribute(): void {}
  load(): void {}
}

for (const gapless of [true, false]) {
  const backend = gapless ? 'buffer' : 'stream'
  test(`${backend}: fast-forward to end does not mark heard; the following track starts a new session`, async () => {
    await audioFixture(gapless, async ({ advance, heard, audios }) => {
      store.getState().playQueue([track(11), track(12)], 0)
      await flush()
      advance(10)
      store.getState().requestSeek(99)
      await settleSeek(gapless)
      advance(2)
      if (!gapless) audios[0].onended?.()
      await flush()
      assert.equal(store.getState().currentIndex, 1)
      assert.deepEqual(heard, [])
      advance(61)
      assert.deepEqual(heard, [12])
    })
  })

  test(`${backend}: pauses and seeks preserve actual accumulation, repeated listening counts once`, async () => {
    await audioFixture(gapless, async ({ advance, heard }) => {
      store.getState().playQueue([track(21), track(22)], 0)
      await flush()
      advance(21)
      store.getState().togglePlay()
      await new Promise((resolve) => setTimeout(resolve, 20))
      advance(500)
      assert.deepEqual(heard, [])
      store.getState().togglePlay()
      await flush()
      store.getState().requestSeek(0)
      await settleSeek(gapless)
      advance(21)
      store.getState().requestSeek(0)
      await settleSeek(gapless)
      advance(21)
      assert.deepEqual(heard, [21])
      advance(10)
      assert.deepEqual(heard, [21])
    })
  })

  test(`${backend}: explicitly restarting the same track resets listening but keeps seeking functional`, async () => {
    await audioFixture(gapless, async ({ advance, heard }) => {
      store.getState().playQueue([track(31), track(32)], 0)
      await flush()
      advance(40)
      store.getState().playQueue([track(31), track(32)], 0)
      await flush()
      advance(0)
      advance(30)
      assert.deepEqual(heard, [])
      store.getState().requestSeek(10)
      await settleSeek(gapless)
      assert.equal(store.getState().currentTime, 10)
      advance(31)
      assert.deepEqual(heard, [31])
    })
  })
}

test('rapid stream seeks settle at the latest target without pausing playback', async () => {
  await audioFixture(false, async ({ advance, audios }) => {
    store.getState().playQueue([track(301)], 0)
    await flush()
    advance(2)
    store.getState().requestSeek(20)
    store.getState().requestSeek(45)
    await new Promise((resolve) => setTimeout(resolve, 25))
    await flush()
    assert.equal(audios[0].currentTime, 45)
    assert.equal(store.getState().currentTime, 45)
    assert.equal(audios[0].paused, false)
  })
})

test('immediate buffer pause-resume keeps the output clock running', async () => {
  await audioFixture(true, async ({ advance, contexts }) => {
    store.getState().playQueue([track(302)], 0)
    await flush()
    advance(2)
    store.getState().setPlaying(false)
    store.getState().setPlaying(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(contexts[0].state, 'running')
    assert.equal(contexts[0].suspends, 0)
    advance(1)
    assert.ok(store.getState().currentTime > 2)
  })
})

test('buffer: pause freezes position without suspending output and resumes from the same PCM', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    store.getState().playQueue([track(304), track(305)], 0)
    await flush()
    advance(14)
    const context = contexts[0]
    const buffer = (engine as any).active.buffer
    const nextBuffer = (engine as any).next.buffer
    const before = store.getState().currentTime
    store.getState().setPlaying(false)
    assert.equal((engine as any).active.pausedOffset, before)
    assert.equal(context.suspends, 0)
    advance(600)
    assert.equal(store.getState().currentTime, before)
    assert.equal(store.getState().isAdvancing, false)
    store.getState().setPlaying(true)
    assert.equal((engine as any).active.buffer, buffer)
    assert.equal((engine as any).next.buffer, nextBuffer)
    assert.equal(context.suspends, 0)
    advance(1)
    assert.ok(store.getState().currentTime > before)
  })
})

test('buffer: a seek lets the retiring source fade before disconnecting it', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    store.getState().playQueue([track(306)], 0)
    await flush()
    advance(3)
    const context = contexts[0]
    const original = context.sources[0]
    store.getState().requestSeek(42)
    assert.equal(original.disconnected, false)
    assert.ok(original.stoppedAt! > context.currentTime)
    assert.equal(context.state, 'running')
    assert.equal(context.suspends, 0)
    assert.equal((engine as any).active.offset, 42)
    original.onended?.()
    assert.equal(original.disconnected, true)
    assert.equal((engine as any).retiringSlots.has((engine as any).active), false)
    assert.equal((engine as any).retiringSlots.size, 0, 'The canceled future slot is released immediately')
  })
})

test('buffer: rapid seeks while paused keep the latest target and do not restart output', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    store.getState().playQueue([track(307)], 0)
    await flush()
    advance(8)
    store.getState().setPlaying(false)
    store.getState().requestSeek(20)
    store.getState().requestSeek(45)
    await flush()
    advance(20)
    assert.equal(store.getState().currentTime, 45)
    assert.equal((engine as any).active.pausedOffset, 45)
    assert.equal(contexts[0].suspends, 0)
    store.getState().setPlaying(true)
    assert.equal((engine as any).active.offset, 45)
    advance(1)
    assert.ok(store.getState().currentTime > 45)
  })
})

test('buffer: a seek requested before decode finishes remains paused until the user resumes', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const original = window.api.playback.inspectFile
    window.api.playback.inspectFile = async (url) => { await pending; return original(url) }
    store.getState().playQueue([track(308)], 0)
    store.getState().requestSeek(30)
    store.getState().setPlaying(false)
    finish()
    await flush()
    assert.equal(store.getState().currentTime, 30)
    assert.equal((engine as any).active.pausedOffset, 30)
    advance(60)
    assert.equal(store.getState().currentTime, 30)
    assert.equal(contexts[0].suspends, 0)
    store.getState().setPlaying(true)
    advance(1)
    assert.ok(store.getState().currentTime > 30)
  })
})

test('immediate stream pause-resume cancels delayed media pause', async () => {
  await audioFixture(false, async ({ audios }) => {
    store.getState().playQueue([track(303)], 0)
    await flush()
    store.getState().setPlaying(false)
    store.getState().setPlaying(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(audios[0].paused, false)
    assert.equal(audios[0].volume, 1)
  })
})

for (const gapless of [true, false]) {
  const backend = gapless ? 'buffer' : 'stream'
  test(`${backend}: sleep freezes progress/listening; wake rebuilds output at the actual position and next still works`, async () => {
    await audioFixture(gapless, async ({ engine, advance, contexts, audios, heard }) => {
      store.getState().playQueue([track(201), track(202)], 0)
      await flush()
      store.getState().requestSeek(10)
      await settleSeek(gapless)
      advance(21)
      const before = store.getState()
      engine.setSystemSuspended(true)
      const position = store.getState().currentTime
      assert.ok(position > 30, 'Recovery must not use the old seekRequest at 10 seconds')
      assert.equal(store.getState().isAdvancing, false)
      if (gapless) assert.equal(contexts[0].state, 'closed')
      else assert.equal(audios[0].paused, true)
      advance(3600)
      assert.equal(store.getState().currentTime, position)
      assert.deepEqual(heard, [])
      engine.setSystemSuspended(false)
      await flush()
      assert.equal(store.getState().currentTime, position)
      assert.equal(store.getState().queue, before.queue)
      assert.equal(store.getState().playbackRun, before.playbackRun)
      assert.equal(store.getState().isPlaying, true)
      if (gapless) assert.equal(contexts.length, 2)
      else assert.equal(audios.length, 2)
      advance(41)
      assert.deepEqual(heard, [201], 'Actual listening before sleep must be retained')
      store.getState().playNext()
      await flush()
      advance(1)
      assert.equal(store.getState().currentIndex, 1)
      assert.ok(store.getState().isAdvancing)
    })
  })

  test(`${backend}: pause, track selection and seek while suspended are respected on wake`, async () => {
    await audioFixture(gapless, async ({ engine, advance, contexts, audios }) => {
      store.getState().playQueue([track(211), track(212)], 0)
      await flush()
      advance(10)
      engine.setSystemSuspended(true)
      const outputs = contexts.length + audios.length
      store.getState().playNext()
      store.getState().requestSeek(18)
      store.getState().setPlaying(false)
      await flush()
      assert.equal(store.getState().currentTime, 18)
      assert.equal(contexts.length + audios.length, outputs, 'No output may start during sleep')
      engine.setSystemSuspended(false)
      await flush()
      advance(100)
      assert.equal(store.getState().currentIndex, 1)
      assert.equal(store.getState().currentTime, 18)
      assert.equal(store.getState().isPlaying, false)
      store.getState().setPlaying(true)
      await flush()
      advance(1)
      assert.ok(store.getState().currentTime > 18)
      assert.equal(store.getState().isAdvancing, true)
      engine.setSystemSuspended(true)
      engine.setMaintenance(true)
      engine.setSystemSuspended(false)
      await flush()
      assert.equal(store.getState().backend, null)
      assert.equal(store.getState().isPlaying, false)
      engine.setMaintenance(false)
      await flush()
      assert.equal(store.getState().isPlaying, false)
    })
  })

  test(`${backend}: resume without a suspend notification ignores a stale or jumped device clock`, async () => {
    await audioFixture(gapless, async ({ engine, contexts, audios, advance, heard }) => {
      store.getState().playQueue([track(221), track(222)], 0)
      await flush()
      advance(12)
      const position = store.getState().currentTime
      if (gapless) { contexts[0].currentTime += 1000; contexts[0].state = 'closed' }
      else audios[0].elapse(1000)
      engine.setSystemSuspended(false)
      await flush()
      assert.equal(store.getState().currentTime, position)
      assert.equal(store.getState().currentIndex, 0)
      assert.deepEqual(heard, [])
      advance(1)
      assert.equal(store.getState().isAdvancing, true)
    })
  })
}

test('wake reuses current and next PCM immediately, even when all new file reads are stalled', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    store.getState().playQueue([track(241), track(242)], 0)
    await flush()
    advance(12)
    const currentBuffer = (engine as any).active.buffer
    const nextBuffer = (engine as any).next.buffer
    engine.setSystemSuspended(true)
    const original = window.api.playback.inspectFile
    let reads = 0
    window.api.playback.inspectFile = () => { reads++; return new Promise(() => {}) }
    engine.setSystemSuspended(false)
    assert.equal(store.getState().backend, 'web-audio', 'Ready PCM must resume synchronously')
    assert.equal((engine as any).active.buffer, currentBuffer)
    assert.equal((engine as any).next.buffer, nextBuffer)
    assert.equal((engine as any).sleepBuffers.size, 0, 'No extra PCM is retained after recovery')
    await flush()
    assert.equal(reads, 0, 'Recovery must not re-inspect or decode either prepared track')
    assert.equal(contexts[1].decodes, 0)
    advance(1)
    assert.equal(store.getState().isAdvancing, true)
    window.api.playback.inspectFile = original
    store.getState().playNext()
    assert.equal((engine as any).active.buffer, nextBuffer)
    await flush()
    advance(1)
    assert.equal(store.getState().isAdvancing, true)
  })
})

for (const change of ['track', 'version', 'url'] as const) {
  test(`sleep buffer is discarded when the current ${change} changes`, async () => {
    await audioFixture(true, async ({ engine, contexts }) => {
      store.getState().playQueue([track(251), track(252)], 0)
      await flush()
      const oldBuffer = (engine as any).active.buffer
      engine.setSystemSuspended(true)
      const replacement = change === 'track' ? track(253) : {
        ...track(251), ...(change === 'version' ? { contentVersion: 'replaced' } : { mediaUrl: 'music://song/new-source' })
      }
      store.getState().playQueue([replacement, track(254)], 0)
      engine.setSystemSuspended(false)
      assert.equal(store.getState().backend, null)
      assert.equal((engine as any).sleepBuffers.size, 0)
      await flush()
      assert.notEqual((engine as any).active.buffer, oldBuffer)
      assert.equal((engine as any).active.track.mediaUrl, replacement.mediaUrl)
      assert.ok(contexts[1].decodes > 0)
    })
  })
}

test('wake releases a cached next track when the queue changes and clears retained PCM on disposal', async () => {
  await audioFixture(true, async ({ engine }) => {
    store.getState().playQueue([track(261), track(262)], 0)
    await flush()
    const currentBuffer = (engine as any).active.buffer
    const oldNext = (engine as any).next.buffer
    engine.setSystemSuspended(true)
    store.getState().playQueue([track(261), track(263)], 0)
    engine.setSystemSuspended(false)
    assert.equal((engine as any).active.buffer, currentBuffer)
    assert.equal((engine as any).sleepBuffers.size, 0)
    await flush()
    assert.equal((engine as any).next.track.songId, 263)
    assert.notEqual((engine as any).next.buffer, oldNext)
    engine.setSystemSuspended(true)
    assert.equal((engine as any).sleepBuffers.size, 2)
    engine.dispose()
    assert.equal((engine as any).sleepBuffers.size, 0)
  })
})

test('wake detaches a stalled decode on the old device; late results cannot replace the new output', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    store.getState().playQueue([track(231), track(232)], 0)
    await flush()
    const context = contexts[0]
    const decode = context.decodeAudioData.bind(context)
    let finish!: () => void
    const stalled = new Promise<void>((resolve) => { finish = resolve })
    context.decodeAudioData = async () => { await stalled; return decode() }
    store.getState().requestSeek(20)
    await flush()
    engine.setSystemSuspended(true)
    engine.setSystemSuspended(false)
    await flush()
    assert.equal(contexts.length, 2)
    assert.equal(store.getState().backend, 'web-audio')
    assert.equal((engine as any).next.track.songId, 232, 'Old stalled decoder must not block the new preload')
    const active = (engine as any).active
    finish()
    await flush()
    assert.equal((engine as any).active, active)
    advance(1)
    assert.equal(store.getState().isAdvancing, true)
    engine.setSystemSuspended(true)
    engine.dispose()
    engine.setSystemSuspended(false)
    await flush()
    assert.equal(contexts.length, 2, 'A disposed engine cannot resume')
  })
})

test('stream: buffering, loading and delayed resumption do not count as listening', async () => {
  await audioFixture(false, async ({ advance, heard, audios }) => {
    store.getState().playQueue([track(41), track(42)], 0)
    await flush()
    advance(30)
    audios[0].readyState = 2
    audios[0].onwaiting?.()
    advance(500)
    audios[0].readyState = 4
    audios[0].onplaying?.()
    advance(29)
    assert.deepEqual(heard, [])
    advance(1)
    assert.deepEqual(heard, [41])
  })
})

test('buffer: a delayed timer settles both sides of a gapless boundary and preserves shuffle lookahead', async () => {
  await audioFixture(true, async ({ advance, heard }) => {
    store.getState().playRandomQueue([track(51), track(52), track(53)])
    await flush()
    const first = store.getState().shuffleOrder[0]
    const second = store.getState().shuffleOrder[1]
    advance(161)
    assert.equal(store.getState().currentIndex, second)
    assert.deepEqual(heard, [store.getState().queue[first].songId, store.getState().queue[second].songId])
    await flush()
    advance(40)
    await flush()
    const last = store.getState().currentIndex
    const upcoming = store.getState().nextShuffleOrder
    assert.ok(isPermutation(upcoming, 3))
    assert.notEqual(upcoming[0], last)
    advance(100)
    assert.equal(store.getState().currentIndex, upcoming[0])
  })
})

test('promotion from Append preserves accumulated listening and the active buffer', async () => {
  await audioFixture(true, async ({ advance, engine, heard }) => {
    const append = { ...track(61), key: 'append:file', songId: null, appendEntry: { fileName: 'file.flac' } } as PlayerTrack
    store.getState().playQueue([append, track(62)], 0)
    await flush()
    advance(40)
    const active = (engine as any).active
    store.getState().promoteAppendTrack('file.flac', { ...track(61), mediaUrl: 'music://library/file.flac' })
    assert.equal((engine as any).active, active)
    advance(21)
    assert.deepEqual(heard, [61])
  })
})

test('single-track shuffle continues as a list loop', async () => {
  await audioFixture(true, async ({ advance }) => {
    store.getState().playRandomQueue([track(71)])
    await flush()
    advance(101)
    assert.equal(store.getState().isPlaying, true)
    assert.equal(store.getState().currentIndex, 0)
    assert.ok(store.getState().currentTime < 2)
  })
})

test('manual next reuses the decoded next buffer immediately, without suspending the audio context', async () => {
  await audioFixture(true, async ({ engine, contexts, advance, heard }) => {
    store.getState().playQueue([track(81), track(82), track(83)], 0)
    await flush()
    advance(20)
    const nextBuffer = (engine as any).next.buffer
    const context = contexts[0]
    const suspends = context.suspends
    const decodes = context.decodes
    store.getState().playNext()
    assert.equal(store.getState().currentIndex, 1)
    assert.equal(store.getState().duration, 100)
    assert.equal(store.getState().currentTime, 0)
    assert.equal((engine as any).active.buffer, nextBuffer)
    assert.equal(context.suspends, suspends)
    assert.equal(context.decodes, decodes)
    advance(61)
    assert.deepEqual(heard, [82])
    await flush()
  })
})

test('manual next adopts an unfinished preload instead of reading and decoding it twice', async () => {
  await audioFixture(true, async ({ engine, contexts, advance }) => {
    const reads: string[] = []
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const original = window.api.playback.inspectFile
    window.api.playback.inspectFile = async (url) => {
      reads.push(url)
      if (url === track(92).mediaUrl) await pending
      return original(url)
    }
    store.getState().playQueue([track(91), track(92), track(93)], 0)
    await flush()
    assert.deepEqual(reads, [track(91).mediaUrl, track(92).mediaUrl])
    const preloadSignal = (engine as any).nextAbort.signal as AbortSignal
    store.getState().playNext()
    assert.equal(preloadSignal.aborted, false)
    await flush()
    assert.equal(store.getState().currentIndex, 1)
    finish()
    await flush()
    assert.equal(store.getState().backend, 'web-audio')
    assert.equal(store.getState().duration, 100)
    assert.equal(reads.filter((url) => url === track(92).mediaUrl).length, 1)
    assert.equal(contexts[0].decodes, 3)
    assert.equal((engine as any).active.track.songId, 92)
    advance(1)
    assert.ok(store.getState().currentTime > 0)
  })
})

test('rapid skips abort adopted preloads and never start an obsolete track', async () => {
  await audioFixture(true, async ({ engine }) => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const original = window.api.playback.inspectFile
    window.api.playback.inspectFile = async (url) => {
      if (url === track(102).mediaUrl) await pending
      return original(url)
    }
    store.getState().playQueue([track(101), track(102), track(103)], 0)
    await flush()
    const signal = (engine as any).nextAbort.signal as AbortSignal
    store.getState().playNext()
    store.getState().playNext()
    assert.equal(signal.aborted, true)
    finish()
    await flush()
    assert.equal(store.getState().currentIndex, 2)
    assert.equal((engine as any).active.track.songId, 103)
    assert.equal(store.getState().currentTime, 0)
  })
})

test('a failed adopted preload immediately falls back to streaming rather than repeating the failed decode', async () => {
  await audioFixture(true, async ({ engine }) => {
    const reads: string[] = []
    let fail!: () => void
    const pending = new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('Streaming required')) })
    const original = window.api.playback.inspectFile
    window.api.playback.inspectFile = async (url) => {
      reads.push(url)
      if (url === track(112).mediaUrl) await pending
      return original(url)
    }
    store.getState().playQueue([track(111), track(112)], 0)
    await flush()
    store.getState().playNext()
    fail()
    await flush()
    assert.equal(store.getState().backend, 'stream')
    assert.equal((engine as any).selected.songId, 112)
    assert.equal(reads.filter((url) => url === track(112).mediaUrl).length, 1)
    assert.equal(store.getState().playbackError, null)
  })
})
