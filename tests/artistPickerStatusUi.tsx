import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ArtistPicker, { type ArtistFormEntry } from '../src/renderer/src/components/ArtistPicker'
import { useArtistSubmitGuard } from '../src/renderer/src/components/ArtistSubmitGuard'
import type { ArtistRow } from '../src/shared/types'

const existing: ArtistRow = { id: 955, name: 'NAGI☆', type: 'Person', country: null, member_ids: null }
const entry = (name: string, extra: Partial<ArtistFormEntry> = {}): ArtistFormEntry =>
  ({ name, role: 'Primary', order: 0, type: 'Person', ...extra })

function Harness({ initial }: { initial: ArtistFormEntry[] }): React.JSX.Element {
  const [artists, setArtists] = useState(initial)
  const guard = useArtistSubmitGuard()
  return <>
    <ArtistPicker artists={artists} onChange={setArtists} />
    <button type="button" onClick={() => { void guard.check(artists) }}>保存</button>
    {guard.dialog}
  </>
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const until = performance.now() + 4000
  while (!check()) {
    if (performance.now() > until) throw new Error(`Timed out: ${label}; ${document.body.innerHTML.slice(0, 3500)}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function run(): Promise<string[]> {
  let omitExactFromSearch = false
  window.api = { artists: {
    findExact: async (name: string) => name.trim().toLowerCase() === existing.name.toLowerCase() ? existing : null,
    search: async (name: string) => !omitExactFromSearch && existing.name.toLowerCase().startsWith(name.trim().toLowerCase()) ? [existing] : []
  } } as never
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const row = (index: number): HTMLDivElement => host.querySelectorAll<HTMLDivElement>('div.relative.flex.items-center.rounded')[index]
  try {
    flushSync(() => root.render(<Harness initial={[entry('NAGI☆', { artistId: 955 }), entry('NAGI☆', { order: 1, createNew: true })]} />))
    await waitFor(() => !!row(1)?.querySelector('.bg-yellow-500'), 'new artist yellow despite selected duplicate')
    if (!row(0)?.querySelector('.bg-green-500')) throw new Error('Existing linked artist is not green')
    row(1).querySelector<HTMLInputElement>('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await waitFor(() => !![...row(1)?.querySelectorAll<HTMLButtonElement>('button') ?? []].find((button) => button.textContent?.includes('#955')), 'new row suggestions')
    const existingCandidate = [...row(1).querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('#955'))
    if (!existingCandidate || !existingCandidate.textContent?.includes('已在列表中')) throw new Error('Selected same-name candidate is hidden')
    existingCandidate.click()
    await waitFor(() => !row(1), 'selecting existing candidate removes redundant new row')
    if (!row(0)?.querySelector('.bg-green-500')) throw new Error('Selecting duplicate removed linked artist')

    flushSync(() => root.render(<Harness key="duplicate" initial={[entry('NAGI☆', { artistId: 955 }), entry('NAGI☆', { order: 1, createNew: true })]} />))
    await waitFor(() => !!row(1)?.querySelector('.bg-yellow-500'), 'duplicate warning after remount')
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '保存')
    if (!save) throw new Error('Missing save button')
    save.click()
    await waitFor(() => !!host.querySelector('.modal-safe-area'), 'new duplicate confirmation')
    if (!host.textContent?.includes('NAGI☆ #955')) throw new Error('Confirmation omitted existing ID')
    host.querySelectorAll<HTMLButtonElement>('.modal-safe-area button')[1].click()

    flushSync(() => root.render(<Harness key="edit" initial={[entry('Other', { artistId: 123 })]} />))
    const input = row(0).querySelector<HTMLInputElement>('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'NAGI☆')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => !!row(0)?.querySelector('.bg-yellow-500'), 'renamed artist yellow')
    if (row(0).querySelector('.bg-green-500')) throw new Error('Renamed artist stayed linked to previous ID')
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await waitFor(() => !![...row(0).querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('#955')), 'edited row suggestions')

    omitExactFromSearch = true
    flushSync(() => root.render(<Harness key="limited-search" initial={[entry('NAGI☆', { artistId: 955 }), entry('NAGI☆', { order: 1, role: 'Featured', createNew: true })]} />))
    await waitFor(() => !!row(1)?.querySelector('.bg-yellow-500'), 'exact match outside search results')
    row(1).querySelector<HTMLInputElement>('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await waitFor(() => !![...row(1).querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('#955')), 'exact match added to candidates')
    ;[...row(1).querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('#955'))!.click()
    await waitFor(() => row(1)?.querySelector('.bg-green-500') != null, 'different role retained')
    if (!row(0) || !row(1) || row(1).querySelector<HTMLSelectElement>('select')?.value !== 'Featured') throw new Error('Different role was removed')
    return ['New same-name artist is yellow and shows selected existing artist as a candidate',
      'Selecting a duplicate candidate removes the redundant new row; renamed artist shows candidate',
      'Exact candidate remains visible when search omits it; distinct song-artist roles are retained']
  } finally { root.unmount(); host.remove() }
}

export const result = run().catch((error) => Promise.reject(String(error)))
