import { Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import MusicView from '../src/renderer/src/views/MusicView'
import SongList from '../src/renderer/src/components/SongList'
import { useLibraryStore } from '../src/renderer/src/stores/libraryStore'
import { usePlayerStore } from '../src/renderer/src/stores/playerStore'
import { toMusicPlayerTrack } from '../src/renderer/src/playerTracks'
import type { SongListItem } from '../src/shared/types'

function check(value: unknown, message: string): void { if (!value) throw new Error(message) }
async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 30)) }

async function run(): Promise<string[]> {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const library = useLibraryStore.getState(), player = usePlayerStore.getState()
  const songs: SongListItem[] = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1, title: `Song ${index + 1}`, length: 200, file_name: `${index}.flac`, add_time: null, last_heard_date: null, score: null, artistNames: 'Artist'
  }))
  let loads = 0, commits = 0
  window.api = { songs: { cover: async () => { loads++; return null }, mediaUrl: file => `mock://${file}` } } as typeof window.api
  try {
    useLibraryStore.setState({ songs, total: songs.length, loaded: true, stale: false, loading: false, query: '' })
    usePlayerStore.setState({ queue: songs.map(toMusicPlayerTrack), currentIndex: 0 })
    flushSync(() => root.render(<Profiler id="Music" onRender={() => { commits++ }}><MusicView /></Profiler>))
    await settle()
    check(host.querySelectorAll('.library-row').length === 200, 'Music no longer shows the complete list')
    const initialLoads = loads
    const before = commits
    for (let index = 0; index < 10; index++) {
      flushSync(() => usePlayerStore.setState({ currentTime: index + 1, duration: 200 }))
      await settle()
    }
    check(commits === before && loads === initialLoads, `Timeline updates rendered Music ${commits - before} times or reloaded covers`)
    flushSync(() => usePlayerStore.setState({ currentIndex: 1 }))
    const rows = host.querySelectorAll('.library-row')
    check(rows[0].getAttribute('data-current') === 'false' && rows[1].getAttribute('data-current') === 'true', 'Changing tracks did not move the highlight')
    flushSync(() => root.render(null))

    let rowRenders = 0, played = '', edited = ''
    const leading = (_song: SongListItem, index: number): number => { rowRenders++; return index + 1 }
    const render = (list: SongListItem[], currentSongId: number, marker: string): void => {
      flushSync(() => root.render(<SongList songs={list} currentSongId={currentSongId} showCover={false} renderLeading={leading}
        onPlay={index => { played = `${marker}:${list[index].id}` }} onEdit={song => { edited = `${marker}:${song.id}` }} />))
    }
    render(songs, 1, 'initial')
    rowRenders = 0
    render(songs, 2, 'new')
    check(rowRenders === 2, `Track switch rendered ${rowRenders} rows instead of the old and new tracks`)
    rowRenders = 0
    render(songs, 2, 'latest')
    check(rowRenders === 0, 'Inline play/edit callbacks invalidated row memoization')
    host.querySelector('.library-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
    host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click()
    check(played === 'latest:1' && edited === 'latest:1', 'Memoized rows used stale play/edit handlers')
    render([...songs].reverse(), 2, 'sorted')
    host.querySelector('.library-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
    check(played === 'sorted:200', 'Sorting changed which song double-click plays')
    render([songs[42]], 43, 'filtered')
    host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click()
    check(edited === 'filtered:43', 'Filtering changed which song is edited')
    return ['200 songs remain on one page; 10 timeline updates cause 0 Music commits and 0 cover reloads', 'Track changes render only the old/new rows; stable handlers stay current after sorting/filtering']
  } finally {
    root.unmount(); host.remove()
    useLibraryStore.setState(library); usePlayerStore.setState(player)
  }
}

export const result = run()
