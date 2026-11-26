import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import FullPlayer from '../src/renderer/src/components/FullPlayer'
import { usePlayerStore, type PlayerTrack } from '../src/renderer/src/stores/playerStore'
import { colors } from '../src/shared/colors'
import type { SongDetail } from '../src/shared/types'

function check(value: unknown, message: string): void { if (!value) throw new Error(message) }
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function run(): Promise<string[]> {
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--palette-${name}`, value)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const previous = usePlayerStore.getState()
  const track: PlayerTrack = { key: 'music-1', title: 'All That Makes Us Human Continues', artistNames: 'BT', songId: 1, mediaUrl: 'mock://music/1.flac', appendEntry: null }
  let detail: SongDetail = {
    id: 1, title: track.title, file_name: '1.flac', length: 400, lyric: null,
    add_time: null, first_heard_date: null, last_heard_date: null, score: null, comment: null,
    artists: [{ id: 1, name: 'BT', role: 'Primary', order: 0 }], tags: [],
    album: { id: 1, title: 'This Binary Universe', release_date: null, album_type: 'Album', total_discs: 1, labels: [], disc_number: 1, track_number: 1, artists: [] }
  }
  let resolveDetail: ((detail: SongDetail) => void) | null = null
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL
  const createdUrls = new Set<string>(), revokedUrls = new Set<string>()
  URL.createObjectURL = blob => { const url = createUrl(blob); createdUrls.add(url); return url }
  URL.revokeObjectURL = url => { revokedUrls.add(url); revokeUrl(url) }
  window.api = {
    songs: { detail: async () => detail, embeddedCover: async () => null, cover: async () => null },
    playback: { formatInfo: async () => ({ sampleRate: 44100 }) }
  } as typeof window.api
  const geometry = (): { top: number; bottom: number; height: number } => {
    const cover = host.querySelector('.full-player-columns > div > div')!.getBoundingClientRect()
    const visualizer = host.querySelector('.audio-visualizer')!.getBoundingClientRect()
    check(Math.abs(cover.top - visualizer.top) < 0.6, 'Visualizer top is not aligned with cover')
    check(Math.abs(visualizer.height - cover.height - 136) < 0.6, 'Visualizer does not reserve the two-line metadata height')
    const content = host.querySelector('.full-player-content')!.getBoundingClientRect()
    check(visualizer.bottom <= content.bottom, 'Fixed visualizer is clipped by the player content')
    return { top: visualizer.top, bottom: visualizer.bottom, height: visualizer.height }
  }
  const select = (next: Partial<PlayerTrack>): void => {
    flushSync(() => usePlayerStore.setState({ queue: [{ ...track, ...next }], currentIndex: 0 }))
  }
  try {
    usePlayerStore.setState({ gaplessReady: true, volume: 0.6, muted: false })
    select({})
    flushSync(() => root.render(<FullPlayer open onClose={() => {}} onNavigate={() => {}} />))
    /* 等全屏入场弹簧结束后再记录布局，避免把入场位移当作内容高度变化。 */
    await delay(1000)
    const original = geometry()
    const sameGeometry = (): boolean => {
      const current = geometry()
      return Math.abs(current.top - original.top) < 0.6 && Math.abs(current.bottom - original.bottom) < 0.6 && Math.abs(current.height - original.height) < 0.6
    }
    const metadata = host.querySelector('.full-player-columns > div')!.children[1]
    const title = metadata.querySelector('.line-clamp-2')!
    const titleLineHeight = parseFloat(getComputedStyle(title).lineHeight)
    check(Math.abs(title.getBoundingClientRect().height - titleLineHeight * 2) < 0.6, 'Fixture title is not actually two lines')
    check(Math.abs(metadata.getBoundingClientRect().bottom - original.bottom) < 0.6, 'Two-line album baseline is not aligned with visualization bottom')
    const metrics = host.querySelector('.audio-visualizer-metrics')!.getBoundingClientRect()
    check(Math.abs(metrics.bottom - original.bottom) < 0.6, 'Metric footer has extra bottom inset')
    select({ title: 'EXIT / DELETE' })
    await delay(450)
    check(sameGeometry(), 'Single-line title changed visualization geometry')
    check(host.querySelector('.line-clamp-2')!.getBoundingClientRect().height === titleLineHeight, 'Single-line title retained unwanted blank title line')
    detail = { ...detail, id: 2, album: null }
    window.api.songs.detail = () => new Promise(resolve => { resolveDetail = resolve })
    select({ key: 'music-2', songId: 2, title: 'Short title' })
    await delay(60)
    check(sameGeometry(), 'Pending metadata changed visualization geometry')
    const fadingMetadata = host.querySelector('.full-player-columns > div')!.children[1]
    check(Number(getComputedStyle(fadingMetadata).opacity) < 1, 'Old title, artist and album did not fade out')
    check(getComputedStyle(fadingMetadata).pointerEvents === 'none', 'Outgoing album/artist links remain interactive')
    resolveDetail!(detail)
    await delay(450)
    check(sameGeometry(), 'Missing album changed visualization geometry')
    const newMetadata = host.querySelector('.full-player-columns > div')!.children[1]
    check(newMetadata.textContent!.includes('Short title') && !newMetadata.textContent!.includes('This Binary Universe'), 'Old metadata was associated with the new song')
    check(Number(getComputedStyle(newMetadata).opacity) === 1, 'New metadata failed to finish fading in')
    flushSync(() => usePlayerStore.setState({ currentTime: 25 }))
    await delay(60)
    check(newMetadata === host.querySelector('.full-player-columns > div')!.children[1] && Number(getComputedStyle(newMetadata).opacity) === 1, 'Progress update restarted the metadata animation')
    /* 小窗口采用同一比例公式，不依赖实际标题高度；检查各尺寸都不裁切。 */
    const section = host.querySelector<HTMLElement>('.full-player-content')!.parentElement!
    const volumeButton = host.querySelector<HTMLButtonElement>('button[aria-label="调整音量"]')!
    const infoButton = host.querySelector<HTMLButtonElement>('button[aria-label="歌曲信息 / 添加到音乐库"]')!
    const volumeRect = volumeButton.getBoundingClientRect(), infoRect = infoButton.getBoundingClientRect()
    check(volumeRect.right < infoRect.left && Math.abs(volumeRect.y + volumeRect.height / 2 - infoRect.y - infoRect.height / 2) < 0.6, 'Volume is not aligned immediately left of track information')
    for (const [width, height] of [[900, 650], [820, 540]]) {
      section.style.width = `${width}px`
      section.style.height = `${height}px`
      await delay(100)
      geometry()
      flushSync(() => volumeButton.click())
      const panel = host.querySelector<HTMLElement>('[role="dialog"][aria-label="调整音量"]')!
      const panelRect = panel.getBoundingClientRect(), playerRect = section.getBoundingClientRect()
      check(panelRect.left >= playerRect.left && panelRect.right <= playerRect.right && panelRect.top >= playerRect.top && panelRect.bottom <= playerRect.bottom, 'Volume popup is clipped in a smaller player')
      check(panel.contains(document.elementFromPoint(panelRect.left + 10, panelRect.top + 10)), 'Volume popup is covered by the player content')
      flushSync(() => host.querySelector('.full-player-content')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
      check(!panel.isConnected, 'Outside click did not close volume popup')
    }
    flushSync(() => volumeButton.click())
    const volumeInput = host.querySelector<HTMLInputElement>('input[aria-label="音量"]')!
    check(volumeInput.value === '60', 'Full player volume did not read shared state')
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(volumeInput, '37')
      volumeInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    check(usePlayerStore.getState().volume === 0.37, 'Volume slider did not update shared playback volume')
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="静音"]')!.click())
    check(usePlayerStore.getState().muted && volumeInput.value === '0', 'Full player mute failed')
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="取消静音"]')!.click())
    check(!usePlayerStore.getState().muted && volumeInput.value === '37', 'Unmuting failed to restore volume')
    flushSync(() => usePlayerStore.getState().setVolume(0.72))
    check(volumeInput.value === '72', 'External volume change did not synchronize with full player')
    flushSync(() => volumeInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })))
    check(!host.querySelector('[role="dialog"][aria-label="调整音量"]') && document.activeElement === volumeButton, 'Escape did not dismiss volume and restore focus')
    const fixture = document.createElement('canvas')
    fixture.width = fixture.height = 8
    fixture.getContext('2d')!.fillRect(0, 0, 8, 8)
    const coverData = new Uint8Array(await (await fetch(fixture.toDataURL())).arrayBuffer())
    window.api.songs.embeddedCover = async () => coverData
    window.api.songs.detail = async id => ({ ...detail, id })
    select({ key: 'music-3', songId: 3 })
    await delay(550)
    const image = host.querySelector<HTMLImageElement>('.playback-cover-fade')!
    check(image.complete && image.naturalWidth === 8 && image.dataset.loaded === 'true', 'Loaded cover did not appear')
    check(Number(getComputedStyle(image).opacity) === 1 && !image.draggable, 'Cover failed to settle or became draggable')
    const previousUrl = image.src
    select({ key: 'music-4', songId: 4 })
    await delay(60)
    check(image.isConnected && !revokedUrls.has(previousUrl) && Number(getComputedStyle(image.parentElement!).opacity) < 1, 'Old cover was released before its fade completed')
    select({ key: 'music-5', songId: 5, title: 'Latest track' })
    await delay(550)
    check(revokedUrls.has(previousUrl) && host.querySelectorAll('.playback-cover-fade').length === 1, 'Cover transition leaked an old layer or URL')
    check(host.querySelector('.line-clamp-2')!.textContent === 'Latest track', 'Rapid switching displayed intermediate metadata')
    geometry()
    return ['Visualizer bounds remain fixed across title/metadata changes and smaller windows', 'Cover and metadata fade in place, rapid switching keeps the latest track, progress updates do not restart fades, and retired cover URLs are released', 'Full-player volume shares playback state, sits left of information, supports mute/slider/dismissal, and stays within smaller windows']
  } finally {
    root.unmount(); host.remove(); usePlayerStore.setState(previous)
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl
    check([...createdUrls].every(url => revokedUrls.has(url)), 'Closing the player leaked cover URLs')
  }
}

export const result = run()
