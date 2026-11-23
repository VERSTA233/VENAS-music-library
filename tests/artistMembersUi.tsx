import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ArtistView from '../src/renderer/src/views/ArtistView'
import { useNavStore } from '../src/renderer/src/stores/navStore'
import type { ArtistRow, NavigationSession } from '../src/shared/types'

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))
function check(value: boolean, message: string): void { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 4000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}; ${document.body.innerText}`)
    await delay()
  }
}
function click(label: string): void {
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"], button[title="${label}"]`)
  if (!element) throw new Error(`Missing button: ${label}`)
  element.click()
}

async function run(): Promise<string[]> {
  const band: ArtistRow = { id: 1, name: 'Band', type: 'Group', country: null, member_ids: '[2]' }
  const member: ArtistRow = { id: 2, name: '後藤まりこ', type: 'Person', country: null, member_ids: null }
  const label: ArtistRow = { id: 3, name: 'Label', type: 'Label', country: null, member_ids: '[2]' }
  const writes: unknown[] = []
  const sessions: NavigationSession[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  window.api = {
    artists: {
      list: async () => [{ ...band, songCount: 0 }, { ...member, songCount: 0 }],
      listLabels: async () => [{ ...label, songCount: 0, albumCount: 0 }],
      detail: async (id: number) => ({ artist: id === 1 ? band : member, members: id === 1 ? [member] : [], aliasOf: null, songs: [] }),
      labelDetail: async () => ({ label, members: [member], groups: [] }),
      picture: async () => null,
      search: async () => [member],
      update: async (...args: unknown[]) => { writes.push(args) }
    },
    navigation: { saveSession: async (session: NavigationSession) => { sessions.push(session) } }
  } as never
  useNavStore.setState(useNavStore.getInitialState(), true)
  useNavStore.getState().restoreSession({ view: 'artist', target: { view: 'artist', id: 1, isLabel: false } })
  flushSync(() => root.render(<ArtistView />))
  const heading = (): string | undefined => document.querySelector('h1')?.textContent ?? undefined
  async function memberAndBack(origin: string): Promise<void> {
    click('查看艺术家 後藤まりこ')
    await waitFor(() => heading() === member.name, 'member homepage')
    check(!document.querySelector('[role="dialog"]'), 'Editor blocks member homepage')
    check(sessions.at(-1)?.target?.view === 'artist' && sessions.at(-1)?.target?.id === 2, 'Member navigation not persisted')
    click('返回')
    await waitFor(() => heading() === origin, 'return to owner homepage')
  }
  try {
    await waitFor(() => heading() === 'Band' && !!document.querySelector('button[title="查看艺术家 後藤まりこ"]'), 'band members')
    await memberAndBack('Band')
    click('编辑艺术家')
    await waitFor(() => !!document.querySelector('[role="dialog"]'), 'band editor')
    const editor = document.querySelector('[role="dialog"]')!
    editor.querySelector<HTMLButtonElement>('button[title="查看艺术家 後藤まりこ"]')!.click()
    await waitFor(() => heading() === member.name, 'member from editor')
    check(!document.querySelector('[role="dialog"]'), 'Editor did not close on navigation')
    click('返回')
    await waitFor(() => heading() === 'Band', 'return to band')
    check(writes.length === 0, 'Opening a member changed membership')

    click('编辑艺术家')
    await waitFor(() => !!document.querySelector('[role="dialog"]'), 'reopen editor')
    click('移除成员 後藤まりこ')
    await delay()
    check(heading() === 'Band', 'Remove button navigated instead of removing')
    check(!document.querySelector('[role="dialog"] button[title="查看艺术家 後藤まりこ"]'), 'Member not removed from draft')
    click('关闭')

    useNavStore.getState().navigate({ view: 'artist', id: 3, isLabel: true })
    await waitFor(() => heading() === 'Label' && !!document.querySelector('button[title="查看艺术家 後藤まりこ"]'), 'label members')
    await memberAndBack('Label')
    click('编辑厂牌')
    await waitFor(() => !!document.querySelector('[role="dialog"]'), 'label editor')
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[title="查看艺术家 後藤まりこ"]')!.click()
    await waitFor(() => heading() === member.name, 'label member from editor')
    click('返回')
    await waitFor(() => heading() === 'Label', 'return to label')
    return ['Band and label member links navigate from homepage and editor; Back returns to owner',
      'Member remove control edits the draft without navigation; navigation does not change membership']
  } finally { root.unmount(); host.remove() }
}

export const result = run()
