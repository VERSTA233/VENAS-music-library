import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useRef } from 'react'
import Cover from '../src/renderer/src/components/Cover'
import SongListToolbarActions from '../src/renderer/src/components/SongListToolbarActions'
import ListSortControl from '../src/renderer/src/components/ListSortControl'
import IngestModal from '../src/renderer/src/components/IngestModal'
import { songFormMetadata, type SongFormValue } from '../src/renderer/src/components/SongForm'
import { useNavStore } from '../src/renderer/src/stores/navStore'
import type { AppendEntry } from '../src/shared/types'
import { useDismissibleLayer } from '../src/renderer/src/hooks/useDismissibleLayer'
import { dispatchCoverUpdate } from '../src/renderer/src/coverUpdates'

function check(value: unknown, message: string): void { if (!value) throw new Error(message) }
async function settle(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 20)) }

function DismissibleProbe({ open, onDismiss }: { open: boolean; onDismiss: () => void }): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  useDismissibleLayer(open, [trigger, panel], onDismiss, true)
  return <><button ref={trigger} data-region="trigger" /><div ref={panel} data-region="panel" /></>
}

async function run(): Promise<string[]> {
  const form: SongFormValue = {
    title: ' Song ', firstHeardDate: ' 2026-11 ', lyric: ' Lyrics ', lyricFilePath: '/test/source.lrc',
    artists: [{ name: 'Artist', role: 'Vocalist', order: 0, type: 'Person', createNew: true }], tags: [],
    album: { title: ' Album ', releaseDate: ' 2026 ', albumType: 'EP', totalDiscs: ' 2 ', labels: ['Label'],
      discNumber: ' 1 ', trackNumber: ' 4 ', artists: [], selectedAlbumId: 7, selectedAlbumSnapshot: null },
    score: '0', comment: ' Comment '
  }
  const metadata = songFormMetadata(form)
  check(metadata.title === 'Song' && metadata.firstHeardDate === '2026-11' && metadata.lyric === 'Lyrics'
    && metadata.comment === 'Comment' && metadata.score === 0 && metadata.lyricFilePath === form.lyricFilePath, 'Shared metadata conversion changed field values or zero score')
  check(metadata.artists === form.artists && metadata.album?.artists.length === 0
    && metadata.album.title === 'Album' && metadata.album.albumId === 7 && metadata.album.releaseDate === '2026'
    && metadata.album.albumType === 'EP' && metadata.album.totalDiscs === 2
    && metadata.album.discNumber === 1 && metadata.album.trackNumber === 4 && metadata.album.labels === form.album.labels, 'Shared conversion changed artist identity, dates or album positions')
  const empty = songFormMetadata({ ...form, score: ' ', lyric: ' ', firstHeardDate: ' ', comment: ' ' }, { ...form.album, title: ' ' })
  check(empty.album === null && empty.score === null && empty.lyric === null && empty.firstHeardDate === null && empty.comment === null, 'Empty fields no longer clear explicitly')
  const approved = songFormMetadata(form, { ...form.album, selectedAlbumId: 8, totalDiscs: '', discNumber: '', trackNumber: '' })
  check(approved.album?.albumId === 8 && approved.album.totalDiscs === null && approved.album.discNumber === null
    && approved.album.trackNumber === null && form.album.selectedAlbumId === 7, 'Confirmed album or optional numbers were lost, or the draft was mutated')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const click = (selector: string): void => {
    const button = host.querySelector<HTMLButtonElement>(selector)
    check(button, `Missing button: ${selector}`)
    button!.click()
  }
  const created: string[] = [], revoked: string[] = []
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL
  URL.createObjectURL = data => { const url = createUrl(data); created.push(url); return url }
  URL.revokeObjectURL = url => { revoked.push(url); revokeUrl(url) }
  let resolveOld: (data: Uint8Array) => void = () => {}
  const old = new Promise<Uint8Array>(resolve => { resolveOld = resolve })
  let loads = 0
  const load = async (): Promise<Uint8Array> => { loads++; return new Uint8Array([1]) }
  try {
    flushSync(() => root.render(<Cover cacheKey="old" resource={{ kind: 'song', id: 1 }} load={() => old} />))
    flushSync(() => root.render(<Cover cacheKey="new" resource={{ kind: 'song', id: 2 }} load={load} />))
    await settle()
    check(created.length === 1 && host.querySelector('img')?.src === created[0], 'Current cover was not rendered')
    resolveOld(new Uint8Array([2]))
    await settle()
    check(created.length === 1 && host.querySelector('img')?.src === created[0], 'Stale cover replaced the current track')
    flushSync(() => root.render(<Cover cacheKey="new" resource={{ kind: 'song', id: 2 }} load={load} className="updated" />))
    await settle()
    check(loads === 1, 'Rendering the same key loaded the cover again')
    dispatchCoverUpdate({ songIds: [1], albumIds: [2], artistIds: [2] })
    await settle()
    check(loads === 1, 'Unrelated song or matching ID of another resource reloaded a cover')
    dispatchCoverUpdate({ songIds: [2], albumIds: [], artistIds: [] })
    await settle()
    check(loads === 2 && revoked.includes(created[0]) && host.querySelector('img')?.src === created[1], 'Cover refresh did not release and replace the old URL')
    flushSync(() => root.render(<Cover cacheKey="failed" load={() => Promise.reject(new Error('unreadable cover'))} />))
    await settle()
    check(!host.querySelector('img') && revoked.includes(created[1]), 'Unreadable cover did not fall back and release its URL')
    flushSync(() => root.render(null))
    dispatchCoverUpdate({ songIds: [2], albumIds: [], artistIds: [] })
    await settle()
    check(loads === 2 && created.every(url => revoked.includes(url)), 'Unmount leaked a cover URL or refresh listener')

    const reads = Array<number>(200).fill(0)
    flushSync(() => root.render(<>{reads.map((_, index) => <Cover key={index} cacheKey={index} resource={{ kind: 'song', id: index + 1 }} load={async () => { reads[index]++; return null }} />)}
      <Cover cacheKey="album" resource={{ kind: 'album', id: 7 }} load={async () => { loads++; return null }} />
      <Cover cacheKey="artist" resource={{ kind: 'artist', id: 8 }} load={async () => { loads++; return null }} />
    </>))
    await settle()
    dispatchCoverUpdate({ songIds: [42], albumIds: [7], artistIds: [8] })
    await settle()
    check(reads.every((count, index) => count === (index === 41 ? 2 : 1)) && loads === 6, 'Targeted cover update reloaded unrelated rows or missed album/artist')
    flushSync(() => root.render(null))

    const observer = window.IntersectionObserver
    let thumbnailLoads = 0
    try {
      window.IntersectionObserver = undefined as never
      flushSync(() => root.render(<Cover cacheKey={900} thumbnailKey="song:900" resource={{ kind: 'song', id: 900 }}
        load={async () => { thumbnailLoads++; return null }} />))
      await settle()
      dispatchCoverUpdate({ songIds: [901], albumIds: [900], artistIds: [900] })
      await settle()
      check(thumbnailLoads === 1, 'Shared refresh subscription reloaded an unrelated thumbnail')
      dispatchCoverUpdate({ songIds: [900], albumIds: [], artistIds: [] })
      await settle()
      check(thumbnailLoads === 2, 'Shared refresh subscription missed an invalidated thumbnail')
      flushSync(() => root.render(null))
      dispatchCoverUpdate({ songIds: [900], albumIds: [], artistIds: [] })
      await settle()
      check(thumbnailLoads === 2, 'Unmounted thumbnail retained its refresh subscription')
    } finally { window.IntersectionObserver = observer }

    let dismissed = 0
    flushSync(() => root.render(<DismissibleProbe open onDismiss={() => { dismissed++ }} />))
    for (const element of host.children) element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    check(dismissed === 0, 'Panel or trigger click dismissed the layer')
    flushSync(() => root.render(<DismissibleProbe open onDismiss={() => { dismissed += 10 }} />))
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    check(dismissed === 10, 'Outside pointer used a stale callback')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    check(dismissed === 20, 'Escape did not dismiss the layer')
    flushSync(() => root.render(<DismissibleProbe open={false} onDismiss={() => { dismissed++ }} />))
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    check(dismissed === 20, 'Closed layer retained document listeners')

    let query = 'test', sort = '', direction = '', random = 0
    flushSync(() => root.render(<SongListToolbarActions query={query} onQueryChange={value => { query = value }} sort="library" onSortChange={value => { sort = value }} direction="desc" onDirectionChange={value => { direction = value }} count={12} searchLabel="搜索歌曲">
      <button onClick={() => random++}>随机播放</button>
    </SongListToolbarActions>))
    click('[aria-label="清空搜索"]')
    check(query === '' && host.innerText.includes('12 首'), 'Shared search/count controls failed')
    click('[aria-label="歌曲排序方式"]')
    await settle()
    click('[role="menuitemradio"]:last-child')
    check(sort === 'addedAt', 'Song sort options changed during consolidation')
    click('[aria-label="歌曲排序降序"]')
    check(direction === 'asc', 'Sort direction no longer toggles')
    Array.from(host.querySelectorAll('button')).find(button => button.textContent === '随机播放')!.click()
    check(random === 1, 'Toolbar lost its page-specific action')
    for (const kind of ['artist', 'album'] as const) {
      flushSync(() => root.render(<ListSortControl kind={kind} value="library" onChange={value => { sort = value }} direction="asc" onDirectionChange={() => {}} />))
      click('[aria-haspopup="menu"]')
      await settle()
      click('[role="menuitemradio"]:last-child')
      check(sort === 'count', `${kind} sort lost its song-count option`)
    }

    const tag = { id: 42, name: 'Heartquake', tag_type: 'Mood', description: null }
    window.api = {
      append: { parseArtists: async () => ({ artists: [], cleanedTitle: '' }) },
      tags: { search: async () => [tag] },
      navigation: { saveSession: async () => {} }
    } as never
    useNavStore.setState({ target: null, returnTo: null, restoreSignal: null })
    const entry: AppendEntry = { fileName: 'test.flac', title: 'Original title', artist: null, album: null, albumArtist: null, labels: [], lyric: 'Unsaved lyrics', lyricFilePath: null, releaseDate: null, discNumber: null, totalDiscs: null, trackNumber: null, duration: 100, hasPicture: false }
    let closed = 0, previewed = 0
    flushSync(() => root.render(<IngestModal entry={entry} onClose={() => { closed++ }} onIngested={() => {}} onPreviewDetail={() => { previewed++ }} />))
    await settle()
    check(!!host.querySelector('button[aria-label="确认入库"]') && !!host.querySelector('button[aria-label="关闭"]'), 'Ingest header lacks confirm/close controls')
    check(![...host.querySelectorAll('button')].some(button => button.textContent?.trim() === '确认入库' || button.textContent?.trim() === '取消'), 'Ingest retained redundant footer actions')
    check(host.querySelector('button[aria-label="确认入库"]')?.classList.contains('modal-confirm-button'), 'Ingest confirm color is not shared with edit modal')
    const setInput = async (input: HTMLInputElement, value: string): Promise<void> => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
    }
    await setInput(host.querySelectorAll<HTMLInputElement>('input')[1], 'Edited title')
    const search = host.querySelector<HTMLInputElement>('input[placeholder="搜索或输入 Tag"]')!
    await setInput(search, 'Heart')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await settle()
    click('[aria-label="查看标签 Heartquake"]')
    await settle()
    const nav = useNavStore.getState()
    check(nav.target?.view === 'tag' && nav.target.id === 42 && nav.target.parentType === 'Mood' && nav.returnTo?.view === 'append', 'Ingest tag preview lost its target or return context')
    check(host.querySelector('[role="dialog"]')!.classList.contains('hidden') && previewed === 1 && closed === 0, 'Tag preview closed the ingest editor')
    useNavStore.getState().requestReturn()
    await settle()
    check(!host.querySelector('[role="dialog"]')!.classList.contains('hidden'), 'Returning from tag did not restore the editor')
    check(host.querySelectorAll<HTMLInputElement>('input')[1].value === 'Edited title' && host.querySelector('textarea')!.value === 'Unsaved lyrics' && host.querySelector('[aria-label="查看标签 Heartquake"]'), 'Tag navigation discarded unsaved form values')
    useNavStore.getState().clearRestoreSignal()
    click('[aria-label="移除标签 Heartquake"]')
    await settle()
    check(!host.querySelector('[aria-label="查看标签 Heartquake"]') && !useNavStore.getState().target && previewed === 1 && closed === 0, 'Removing a tag navigated or closed the editor')
    return ['Shared covers ignore stale results, refresh only requested IDs across 200 songs, and release URLs/listeners', 'Dismissible layers preserve separate panel/trigger regions, use current callbacks and remove listeners', 'Shared toolbar preserves search clearing, counts, page actions and all three sort configurations', 'Ingest uses distinct top-bar confirm and close controls with no redundant footer', 'Ingest tag preview preserves unsaved edits on return and keeps removal separate from navigation']
  } finally {
    root.unmount(); host.remove()
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl
  }
}

export const result = run()
