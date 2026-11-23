import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ArtistEditModal from '../src/renderer/src/components/ArtistEditModal'
import type { ArtistAliasOf, ArtistAliasPlan, ArtistAliasType, ArtistRow } from '../src/shared/types'

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))
async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 4000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}; ${document.body.innerText}`)
    await delay()
  }
}
function check(value: boolean, message: string): void { if (!value) throw new Error(message) }
function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find((element) => element.textContent === text)
  if (!result) throw new Error(`Missing button: ${text}`)
  return result
}
function input(value: string): void {
  const element = document.querySelector<HTMLInputElement>('#merge-artist')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function run(): Promise<string[]> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const writes: unknown[][] = []
  let previews = 0
  let saved = 0
  let renderCount = 0
  let plan: ArtistAliasPlan
  const artist = (id: number, name: string): ArtistRow => ({ id, name, type: 'Person', country: null, member_ids: null })
  window.api = { artists: {
    picture: async () => null,
    search: async () => [artist(3, 'C')],
    previewAlias: async () => { previews++; return plan },
    setAlias: async (...args: unknown[]) => { writes.push(args) }
  } } as never
  async function render(current: ArtistRow, aliasOf: ArtistAliasOf | null = null): Promise<void> {
    flushSync(() => root.render(<ArtistEditModal key={++renderCount} artist={current} aliasOf={aliasOf}
      onClose={() => undefined} onSaved={() => { saved++ }} />))
    await waitFor(() => document.querySelector('#artist-edit-title')?.textContent === `编辑 ${current.name}`, 'render artist')
  }
  const results: string[] = []
  try {
    plan = { selectedArtist: { id: 3, name: 'C' }, canonicalArtist: { id: 3, name: 'C' }, needsConfirmation: true,
      aliases: [{ id: 2, name: 'B', aliasType: 'alias' }, { id: 1, name: 'A', aliasType: 'former name' }] }
    await render(artist(2, 'B'))
    button('设为别名').click()
    await waitFor(() => !!document.querySelector('#merge-artist'), 'open alias editor')
    input('C')
    await waitFor(() => [...document.querySelectorAll('button')].some((item) => item.textContent === 'CPerson'), 'candidate')
    button('CPerson').click()
    await delay()
    button('确认关联').click()
    await waitFor(() => !!document.querySelector('#alias-plan-title'), 'show plan')
    check(writes.length === 0, 'Preview wrote relationships before confirmation')
    const region = document.querySelector('[aria-labelledby="alias-plan-title"]')!
    check(region.textContent!.includes('统一归入 C') && region.textContent!.includes('former name'), 'Missing final root or retained type')
    check(region.querySelectorAll('li').length === 2, 'Missing affected aliases')
    button('返回修改').click()
    await waitFor(() => !document.querySelector('#alias-plan-title'), 'return to draft')
    check(writes.length === 0, 'Cancel wrote relationships')
    check(document.querySelector<HTMLInputElement>('#merge-artist')?.value === 'C', 'Cancel discarded target')
    button('确认关联').click()
    await waitFor(() => !!document.querySelector('#alias-plan-title'), 'show plan again')
    button('确认归并').click()
    await waitFor(() => saved === 1, 'save after confirmation')
    check(JSON.stringify(writes) === JSON.stringify([[2, 3, 'alias']]), 'Unexpected save target or duplicate write')
    results.push('Moving a main artist: affected names/types shown, return preserves draft, writes only after confirmation')

    plan = { selectedArtist: { id: 2, name: 'B' }, canonicalArtist: { id: 3, name: 'C' }, needsConfirmation: true,
      aliases: [{ id: 1, name: 'A', aliasType: 'former name' }] }
    await render(artist(1, 'A'), { id: 2, name: 'B', aliasType: 'former name' })
    button('编辑').click()
    await waitFor(() => !!document.querySelector('#merge-artist'), 'edit existing alias')
    check(document.querySelector<HTMLSelectElement>('#alias-type')?.value === 'former name', 'Lost existing alias type')
    button('保存').click()
    await waitFor(() => !!document.querySelector('#alias-plan-title'), 'redirect confirmation')
    check(document.body.textContent!.includes('B 已是 C 的别名'), 'Missing alias-to-root explanation')
    check(writes.length === 1, 'Redirect saved before confirmation')
    button('返回修改').click()
    await delay()
    input('')
    await delay()
    const previewCount = previews
    button('保存').click()
    await waitFor(() => saved === 2, 'clear alias')
    check(previews === previewCount, 'Clearing alias unnecessarily requested a flattening preview')
    check(JSON.stringify(writes[1]) === JSON.stringify([1, null, 'former name']), 'Clearing alias did not preserve intended null target')
    results.push('Selecting an alias explains final root; clearing an existing alias still works')

    plan = { selectedArtist: { id: 3, name: 'C' }, canonicalArtist: { id: 3, name: 'C' }, needsConfirmation: false,
      aliases: [{ id: 1, name: 'A', aliasType: 'alias' }] }
    await render(artist(1, 'A'), { id: 3, name: 'C', aliasType: 'alias' as ArtistAliasType })
    button('编辑').click()
    await waitFor(() => !!document.querySelector('#merge-artist'), 'ordinary edit')
    button('保存').click()
    await waitFor(() => saved === 3, 'ordinary alias saves')
    check(!document.querySelector('#alias-plan-title'), 'Ordinary alias has an unnecessary extra confirmation')
    results.push('Ordinary direct relationships save with no extra confirmation')
  } finally { root.unmount(); host.remove() }
  return results
}

export const result = run()
