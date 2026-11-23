import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AudioTagWriteSettings from '../src/renderer/src/components/AudioTagWriteSettings'
import type { AudioTagWriteProgress } from '../src/shared/types'

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 4000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(document.body.innerText)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
function check(value: unknown, label: string): void { if (!value) throw new Error(label) }

async function run(): Promise<string[]> {
  let saved: AudioTagWriteProgress | null = null
  let starts = 0, cancellations = 0, lateResolve: ((value: AudioTagWriteProgress) => void) | undefined
  const listeners = new Set<(value: AudioTagWriteProgress) => void>()
  window.api = { library: {
    getAudioTagProgress: () => saved ? new Promise(resolve => { lateResolve = resolve }) : Promise.resolve(null),
    onAudioTagProgress: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
    startAudioTagWrite: async () => {
      starts++
      saved = { taskId: 'one', revision: 1, status: 'running', phase: 'checking', completed: 0, total: 10, written: 0, skipped: 0, failed: 0, currentSong: null, errors: [] }
      return saved
    },
    cancelAudioTagWrite: async () => { cancellations++; saved = { ...saved!, revision: saved!.revision + 1, status: 'cancelling' }; return saved }
  } } as typeof window.api
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const mount = (key: number): void => flushSync(() => root.render(<AudioTagWriteSettings key={key} />))
  const send = (patch: Partial<AudioTagWriteProgress>): void => {
    saved = { ...saved!, ...patch, revision: saved!.revision + 1 }
    for (const listener of listeners) listener(saved)
  }
  try {
    mount(1)
    await waitFor(() => !host.querySelector('button')!.disabled)
    host.querySelector('button')!.click()
    await waitFor(() => host.innerText.includes('停止写入'))
    send({ completed: 3, written: 2, skipped: 1, currentSong: { songId: 4, title: '正在写入', fileName: 'file.flac' } })
    await waitFor(() => host.innerText.includes('3 / 10'))
    flushSync(() => root.render(null))
    check(listeners.size === 0 && cancellations === 0, 'Leaving settings leaked a subscription or cancelled the task')
    send({ completed: 6, written: 5 })
    const old = structuredClone(saved!)
    mount(2)
    await waitFor(() => !!lateResolve)
    send({ completed: 7, written: 6 })
    lateResolve!(old)
    await waitFor(() => host.innerText.includes('7 / 10'))
    check(host.querySelector('progress')?.value === 7 && starts === 1, 'Remount restarted the task or accepted a stale snapshot')
    host.querySelector('button')!.click()
    await waitFor(() => host.innerText.includes('正在停止'))
    check(cancellations === 1, 'Cancel was not requested exactly once')
    send({ status: 'completed', completed: 10, failed: 1, errors: [{ songId: 8, title: '失败歌曲', fileName: 'missing.flac', message: '文件不存在' }] })
    await waitFor(() => host.innerText.includes('查看失败详情'))
    host.querySelector('summary')!.click()
    check(host.innerText.includes('missing.flac') && host.innerText.includes('文件不存在'), 'Error detail is missing')
    return ['Live progress survives settings unmount / remount without cancellation or duplicate starts', 'Old snapshots cannot overwrite newer events; stop and per-song errors remain accessible']
  } finally { root.unmount(); host.remove() }
}

export const result = run()
