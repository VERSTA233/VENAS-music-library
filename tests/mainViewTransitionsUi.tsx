import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import App from '../src/renderer/src/App'
import { useMainViewTransition } from '../src/renderer/src/hooks/useMainViewTransition'
import { useLibraryStore } from '../src/renderer/src/stores/libraryStore'
import { useNavStore } from '../src/renderer/src/stores/navStore'
import { usePlayerStore } from '../src/renderer/src/stores/playerStore'
import { defaultListSortPreferences } from '../src/shared/listSorting'
import { colors } from '../src/shared/colors'
import type { AppendEntry, SongListItem } from '../src/shared/types'

function check(value: unknown, message: string): void { if (!value) throw new Error(message) }
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
async function until(condition: () => boolean, message: string): Promise<void> {
  const start = performance.now()
  while (!condition() && performance.now() - start < 2500) await delay(20)
  check(condition(), message)
}

function TransitionProbe(): React.JSX.Element {
  const [page, setPage] = useState('initial')
  const transition = useMainViewTransition()
  return <><button onClick={() => transition(() => setPage('old'))}>old</button><button onClick={() => transition(() => setPage('latest'))}>latest</button><main>{page}</main></>
}

async function run(): Promise<string[]> {
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--palette-${name}`, value)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const nativeTransition = document.startViewTransition?.bind(document)
  const matchMedia = window.matchMedia.bind(window)
  const jobs: { update: () => void; skip: () => void; skipped: boolean }[] = []
  let applied = 0
  const songs: SongListItem[] = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, title: `Song ${index + 1}`, file_name: `${index}.flac`, length: 180, add_time: null, last_heard_date: null, score: null, artistNames: 'Artist' }))
  const entry: AppendEntry = { fileName: 'preview.flac', title: 'Draft song', artist: null, album: null, albumArtist: null, labels: [], lyric: 'Original lyric', lyricFilePath: null, releaseDate: null, discNumber: null, totalDiscs: null, trackNumber: null, duration: 180, hasPicture: false }
  let releaseSongs: () => void = () => {}
  let releaseAppend: () => void = () => {}
  let songRequests = 0, scans = 0
  const artist = { id: 1, name: 'Artist', type: 'Person', country: null, member_ids: null, songCount: songs.length }
  const library = useLibraryStore.getState(), player = usePlayerStore.getState(), nav = useNavStore.getState()
  window.api = {
    navigation: { getSession: async () => ({ view: 'music', target: null }), saveSession: async () => {}, getListSortPreferences: async () => defaultListSortPreferences, setListSortPreference: async () => {} },
    library: { onCoverUpdated: () => () => {}, onMaintenanceChange: () => () => {}, getMaintenanceState: async () => null },
    playback: {
      onSystemSuspended: () => () => {}, getSystemSuspended: async () => false,
      getGapless: async () => true, getVolume: async () => ({ volume: 1, muted: false }), setVolume: async () => {},
      lastHeardDates: async () => [], getSession: async () => null, saveSession: async () => {}
    },
    songs: { list: () => { songRequests++; return new Promise(resolve => { releaseSongs = () => resolve({ items: songs, total: songs.length }) }) }, cover: async () => null, mediaUrl: file => `mock://${file}` },
    append: { scan: () => { scans++; return new Promise(resolve => { releaseAppend = () => resolve([entry]) }) }, cover: async () => null, parseArtists: async () => ({ artists: [], cleanedTitle: 'Draft song' }) },
    artists: { list: async () => [artist], listLabels: async () => [], picture: async () => null, detail: async () => ({ artist, aliasOf: null, members: [], songs }) },
    albums: { list: async () => [] },
    tags: { search: async () => [], listTypes: async () => [] }
  } as typeof window.api
  const click = (text: string): void => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('aside button')].find(button => button.textContent === text)
    check(button, `Missing sidebar ${text}`)
    button!.click()
  }
  try {
    /* 被跳过的原生过渡仍可能调用更新函数：旧导航不得复活。 */
    document.startViewTransition = ((update: () => void) => {
      let finish: () => void = () => {}
      const finished = new Promise<void>(resolve => { finish = resolve })
      const job = { update: () => { applied++; update(); finish() }, skip: finish, skipped: false }
      jobs.push(job)
      return { finished, skipTransition: () => { job.skipped = true; finish() } }
    }) as typeof document.startViewTransition
    flushSync(() => root.render(<TransitionProbe />))
    host.querySelectorAll<HTMLButtonElement>('button')[0].click()
    host.querySelectorAll<HTMLButtonElement>('button')[1].click()
    check(jobs[0].skipped, 'Fast navigation did not cancel the previous animation')
    jobs[1].update(); jobs[0].update()
    check(host.querySelector('main')?.textContent === 'latest', 'Late transition restored an old page')
    host.querySelectorAll<HTMLButtonElement>('button')[0].click()
    flushSync(() => root.render(null))
    check(jobs[2].skipped, 'Unmount retained the transition')
    jobs[2].update()

    window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)' ? { ...matchMedia(query), matches: true } as MediaQueryList : matchMedia(query)
    flushSync(() => root.render(<TransitionProbe />))
    host.querySelectorAll<HTMLButtonElement>('button')[0].click()
    await delay(0)
    check(jobs.length === 3 && host.querySelector('main')?.textContent === 'old', 'Reduced motion still used a snapshot animation')
    flushSync(() => root.render(null))
    window.matchMedia = matchMedia
    document.startViewTransition = undefined as never
    flushSync(() => root.render(<TransitionProbe />))
    host.querySelectorAll<HTMLButtonElement>('button')[1].click()
    await delay(0)
    check(host.querySelector('main')?.textContent === 'latest', 'Missing snapshot API prevented navigation')
    flushSync(() => root.render(null))
    document.startViewTransition = nativeTransition!

    useLibraryStore.setState({ songs: [], total: 0, query: '', loaded: false, loading: false, stale: true })
    usePlayerStore.setState({ queue: [], currentIndex: null })
    useNavStore.setState({ target: null, returnTo: null, restoreSignal: null })
    flushSync(() => root.render(<App />))
    await until(() => songRequests > 0, 'Music did not start loading')
    check(!!host.querySelector('[aria-busy="true"] [role="status"]') && !host.textContent?.includes('音乐库为空'), 'First load flashed a false empty library')
    releaseSongs()
    await until(() => host.querySelectorAll('.library-row').length === 200, 'Loaded songs were held back by animation')
    const rowHeight = host.querySelector('.library-row')!.getBoundingClientRect().height
    check(rowHeight === 64, `Music density changed to ${rowHeight}px`)
    check(getComputedStyle(host.querySelector('.library-main-view')!).viewTransitionName === 'library-main', 'Main pane is not scoped for snapshots')
    check(getComputedStyle(document.documentElement, '::view-transition').pointerEvents === 'none', 'Transition overlay intercepts playback/sidebar input')
    const search = host.querySelector('.library-toolbar-control')!
    check(search.getBoundingClientRect().height === 32, 'Search and sort control sizing is inconsistent')
    await delay(200)
    click('Append')
    await until(() => scans === 1, 'Append did not begin loading during the transition')
    check(!!host.querySelector('[aria-busy="true"]'), 'Append has no loading placeholder')
    releaseAppend()
    await until(() => !!host.querySelector('[aria-label="添加到音乐库"]'), 'Append did not reveal loaded files')
    check(host.querySelector('.library-row')!.getBoundingClientRect().height === rowHeight, 'Append and Music row heights differ')
    await delay(220)
    host.querySelector<HTMLButtonElement>('[aria-label="添加到音乐库"]')!.click()
    await delay(40)
    const input = host.querySelectorAll<HTMLInputElement>('[role="dialog"] input')[1]
    check(input, 'Ingest draft did not open')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Keep this draft')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await delay(20)
    flushSync(() => useNavStore.getState().navigate({ view: 'artist', id: 1, isLabel: false }, { view: 'append' }))
    await delay(80)
    host.querySelector<HTMLButtonElement>('.library-main-view > div:not(.hidden) [aria-label="返回"]')!.click()
    await delay(80)
    check(host.querySelectorAll<HTMLInputElement>('[role="dialog"] input')[1]?.value === 'Keep this draft' && scans === 1, 'Returning from detail lost the ingest draft or rescanned Append')
    host.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="关闭"]')!.click()
    click('Music'); click('Album'); click('Artist')
    await until(() => host.querySelector('.library-main-view h1')?.textContent === 'Artist', 'Rapid navigation did not settle on the last click')
    await delay(250)
    check(host.querySelectorAll('.library-main-view h1').length === 1 && !host.querySelector('[role="dialog"]'), 'Departed views or modals remained mounted')
    click('Music')
    await until(() => host.querySelectorAll('.library-row').length === 200, 'Returning to cached Music lost rows')
    check(songRequests === 1, 'A visual transition caused Music to reload unchanged data')
    window.api.songs.list = async () => { throw new Error('Test read failure') }
    useLibraryStore.setState({ songs: [], total: 0, loaded: false, stale: true })
    await useLibraryStore.getState().fetchSongs().catch(() => undefined)
    await delay(40)
    check(!!host.querySelector('[role="alert"]') && !host.querySelector('[aria-busy="true"]'), 'Failed read left a permanent skeleton or a false empty state')
    window.api.songs.list = async () => ({ items: songs, total: songs.length })
    const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重试')
    retry!.click()
    await until(() => host.querySelectorAll('.library-row').length === 200, 'Retry did not recover from a failed read')
    check(applied === 3, 'Transition cancellation test did not exercise all callbacks')
    return ['Main-only cross-fade leaves controls interactive; rapid clicks and disposal cancel obsolete navigation', 'Reduced motion bypasses snapshots; loaded content appears without a timer', 'Music and Append retain 64px rows; initial loading never flashes an empty library', 'Append draft survives detail navigation; returning to Music reuses its loaded songs']
  } finally {
    document.startViewTransition = nativeTransition!
    window.matchMedia = matchMedia
    root.unmount(); host.remove()
    useLibraryStore.setState(library); usePlayerStore.setState(player); useNavStore.setState(nav)
  }
}

export const result = run()
