import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import MusicView from '../src/renderer/src/views/MusicView'
import ArtistView from '../src/renderer/src/views/ArtistView'
import AlbumView from '../src/renderer/src/views/AlbumView'
import { useLibraryStore } from '../src/renderer/src/stores/libraryStore'
import { useListSortStore } from '../src/renderer/src/stores/listSortStore'
import { useNavStore } from '../src/renderer/src/stores/navStore'
import { defaultListSortPreferences, normalizeListSortPreferences } from '../src/shared/listSorting'
import { sortSongs } from '../src/renderer/src/songSearch'
import type { SongListItem } from '../src/shared/types'

function check(value: unknown, message: string): void { if (!value) throw new Error(message) }
async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 40)) }

async function run(): Promise<string[]> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const library = useLibraryStore.getState(), navigation = useNavStore.getState(), sorts = useListSortStore.getState()
  let saved = structuredClone(defaultListSortPreferences)
  const calls: string[] = []
  const songs: SongListItem[] = [
    { id: 1, title: 'Low', length: 120, file_name: '1.flac', add_time: null, last_heard_date: '2025-01-01', score: 0, artistNames: 'Artist' },
    { id: 2, title: 'High', length: 120, file_name: '2.flac', add_time: null, last_heard_date: '2026-01-01', score: 100, artistNames: 'Artist' },
    { id: 3, title: 'Empty', length: 120, file_name: '3.flac', add_time: null, last_heard_date: null, score: null, artistNames: 'Artist' }
  ]
  const artist = { id: 1, name: 'Artist', type: 'Person', country: null, member_ids: null, songCount: 3 }
  const album = { id: 1, title: 'Album', release_date: null, album_type: null, total_discs: 1, labels: [], artistNames: 'Artist', songCount: 3 }
  window.api = {
    navigation: {
      saveSession: async () => {},
      getListSortPreferences: async () => normalizeListSortPreferences(JSON.parse(JSON.stringify(saved))),
      setListSortPreference: async (key, preference) => { saved = { ...saved, [key]: structuredClone(preference) } }
    },
    songs: {
      list: async (sort = 'library', query = '', direction = 'desc') => {
        calls.push(`${sort}:${direction}:${query}`)
        const items = sortSongs(songs.filter(song => song.title.includes(query)), sort, direction)
        return { items, total: items.length }
      },
      cover: async () => null, mediaUrl: file => `mock://${file}`
    },
    artists: {
      list: async () => [artist], listLabels: async () => [], picture: async () => null,
      detail: async () => ({ artist, aliasOf: null, members: [], songs })
    },
    albums: {
      list: async () => [album], cover: async () => null,
      detail: async () => ({ album, artists: [], songs: songs.map((song, index) => ({ ...song, disc_number: 1, track_number: index + 1 })) })
    }
  } as typeof window.api

  const click = async (selector: string): Promise<void> => {
    const element = host.querySelector<HTMLButtonElement>(selector)
    check(element, `Missing button ${selector}`)
    element!.click()
    await settle()
  }
  const choose = async (label: string, option: string): Promise<void> => {
    await click(`[aria-label="${label}排序方式"]`)
    const button = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(element => element.textContent?.trim() === option)
    check(button, `Missing option ${option}`)
    button!.click()
    await settle()
  }
  const mount = async (view: React.JSX.Element): Promise<void> => {
    flushSync(() => root.render(null))
    flushSync(() => root.render(view))
    await settle()
  }
  const checkRows = (titles: string[]): void => {
    const rows = [...host.querySelectorAll('.library-row')]
    check(rows.length === titles.length && rows.every((row, index) => row.textContent?.includes(titles[index])), `Unexpected song order: ${rows.map(row => row.textContent)}`)
  }
  try {
    useListSortStore.setState({ preferences: structuredClone(defaultListSortPreferences) })
    useLibraryStore.setState({ songs: [], total: 0, loaded: false, stale: true, query: '' })
    useNavStore.setState({ target: null, returnTo: null, restoreSignal: null })
    await mount(<MusicView />)
    await choose('歌曲', '评分')
    checkRows(['High', 'Low', 'Empty'])
    await click('[aria-label="歌曲排序降序"]')
    checkRows(['Low', 'High', 'Empty'])
    await mount(<ArtistView />)
    await choose('艺术家', '歌曲数量')
    await mount(<AlbumView />)
    await choose('专辑', '音乐库顺序')
    await click('[aria-label="专辑排序降序"]')
    await mount(<MusicView />)
    check(host.querySelector('[aria-label="歌曲排序方式"]')?.textContent?.includes('评分') && !!host.querySelector('[aria-label="歌曲排序升序"]'), 'Music forgot its preference on return')
    checkRows(['Low', 'High', 'Empty'])
    await mount(<ArtistView />)
    check(host.querySelector('[aria-label="艺术家排序方式"]')?.textContent?.includes('歌曲数量'), 'Artist grid forgot its preference')
    flushSync(() => useNavStore.getState().navigate({ view: 'artist', id: 1, isLabel: false }))
    await settle()
    await choose('歌曲', '最近聆听时间')
    checkRows(['High', 'Low', 'Empty'])
    check(saved.music.sort === 'score' && saved.artistSongs.sort === 'lastHeard', 'Detail sorting overwrote the independent Music preference')

    /* 模拟渲染进程重启：清空内存，按 App 的流程从持久化接口恢复。 */
    flushSync(() => root.render(null))
    const persisted = JSON.stringify(saved)
    useListSortStore.setState({ preferences: structuredClone(defaultListSortPreferences) })
    useLibraryStore.setState({ songs: [], total: 0, loaded: false, stale: true })
    useListSortStore.setState({ preferences: await window.api.navigation.getListSortPreferences() })
    check(JSON.stringify(saved) === persisted, 'Restoring defaults overwrote saved preferences')
    useNavStore.setState({ target: null })
    await mount(<MusicView />)
    checkRows(['Low', 'High', 'Empty'])
    check(calls.at(-1) === 'score:asc:', 'Initial query did not use restored sorting')
    await mount(<AlbumView />)
    check(host.querySelector('[aria-label="专辑排序方式"]')?.textContent?.includes('音乐库顺序') && !!host.querySelector('[aria-label="专辑排序升序"]'), 'Album did not restore its saved choice and direction')
    useNavStore.setState({ target: { view: 'artist', id: 1, isLabel: false } })
    await mount(<ArtistView />)
    checkRows(['High', 'Low', 'Empty'])
    check(host.querySelector('[aria-label="歌曲排序方式"]')?.textContent?.includes('最近聆听时间'), 'Artist detail did not restore its saved sorting')
    await mount(<MusicView />)
    await useLibraryStore.getState().setQuery('High')
    await useLibraryStore.getState().setQuery('')
    check(useListSortStore.getState().preferences.music.sort === 'score' && saved.music.direction === 'asc', 'Clearing search discarded sorting')
    return ['Music, Artist and Album retain independent sorting and direction after remount and simulated restart', 'Artist detail shares both new song sorts; nulls stay last and zero scores remain sortable', 'Restored Music sorting is used for the first query; clearing search preserves preferences']
  } finally {
    root.unmount()
    host.remove()
    useListSortStore.setState(sorts)
    useLibraryStore.setState(library)
    useNavStore.setState(navigation)
  }
}

export const result = run()
