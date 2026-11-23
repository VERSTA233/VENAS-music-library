import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import SongEditModal from '../src/renderer/src/components/SongEditModal'
import type { SongDetail } from '../src/shared/types'

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const until = performance.now() + 4000
  while (!check()) {
    if (performance.now() > until) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function run(): Promise<string[]> {
  const detail: SongDetail = {
    id: 12, title: 'Header test', length: 80, lyric: null, file_name: 'header-test.flac',
    add_time: null, first_heard_date: null, last_heard_date: null, score: null, comment: null,
    artists: [], tags: [], album: null
  }
  let saved = 0
  window.api = { songs: {
    detail: async () => detail,
    update: async () => { saved++; return { fileName: detail.file_name, audioReplaced: false } }
  } } as never
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(<SongEditModal songId={12} onClose={() => {}} onSaved={() => {}} />))
    await waitFor(() => !!host.querySelector('[aria-label="编辑歌曲信息"]'), 'song details')
    if (host.querySelector('[aria-label="保存"]')) throw new Error('Save appears before edit mode')
    host.querySelector<HTMLButtonElement>('[aria-label="编辑歌曲信息"]')!.click()
    await waitFor(() => !!host.querySelector('[aria-label="保存"]'), 'song editor save check')
    if (![...host.querySelectorAll('button')].every(button => !['保存', '取消'].includes(button.textContent?.trim() ?? ''))) throw new Error('Editor retains footer actions')
    const saveButton = host.querySelector<HTMLButtonElement>('[aria-label="保存"]')!
    const closeButton = host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!
    if (!saveButton.classList.contains('modal-confirm-button') || !closeButton.classList.contains('modal-close-button')) throw new Error('Header control colors diverge')
    saveButton.click()
    await waitFor(() => saved === 1, 'saving from top-bar check')
    return ['Song details enter edit mode without save icon; edit mode saves through colored top-bar check with no footer actions']
  } finally { root.unmount(); host.remove() }
}

export const result = run().catch((error) => Promise.reject(String(error)))
