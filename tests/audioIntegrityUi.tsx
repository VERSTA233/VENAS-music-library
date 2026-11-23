import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AudioIntegritySettings from '../src/renderer/src/components/AudioIntegritySettings'
import ToolsView from '../src/renderer/src/views/ToolsView'
import InspectView from '../src/renderer/src/views/InspectView'
import SettingsView from '../src/renderer/src/views/SettingsView'
import type { AudioIntegrityProgress, AudioIntegrityProgressUpdate } from '../src/shared/types'

function check(value: unknown, label: string): void { if (!value) throw new Error(label) }
async function waitFor(check: () => boolean): Promise<void> {
  const until = performance.now() + 4000
  while (!check()) {
    if (performance.now() > until) throw new Error(document.body.innerText)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function run(): Promise<string[]> {
  let saved: AudioIntegrityProgress = { revision: 0, status: 'idle', phase: 'hashing', total: 0, completed: 0, scanned: 0, skipped: 0, failed: 0, currentSong: null, issues: [], error: null }
  let starts = 0, stops = 0, lateResolve: ((p: AudioIntegrityProgress) => void) | null = null, delaySnapshot = false
  const listeners = new Set<(p: AudioIntegrityProgressUpdate) => void>()
  window.api = { library: {
    getRoots: async () => ({ musicRoot: '/library', systemRoot: '/system', neteaseMusicRoot: null }),
    getAudioTagProgress: async () => null,
    onAudioTagProgress: () => () => {},
    getAudioIntegrityProgress: () => delaySnapshot ? new Promise(resolve => { lateResolve = resolve }) : Promise.resolve(saved),
    onAudioIntegrityProgress: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
    startAudioIntegrityScan: async () => { starts++; saved = { ...saved, revision: 1, status: 'running', total: 10 }; return saved },
    cancelAudioIntegrityScan: async () => { stops++; saved = { ...saved, revision: saved.revision + 1, status: 'cancelling' }; return saved }
  }, playback: {
    getAudioOutput: async () => ({ supported: true, selectedBackend: 'avfoundation', activeBackend: 'avfoundation', launchOverride: false })
  } } as typeof window.api
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const send = (patch: Partial<AudioIntegrityProgress>, changes: AudioIntegrityProgressUpdate['issueChanges'] = []): void => {
    const { issues: replacement, ...fields } = patch
    const issueMap = new Map((replacement ?? saved.issues).map(issue => [issue.songId, issue]))
    for (const change of changes) change.issue ? issueMap.set(change.songId, change.issue) : issueMap.delete(change.songId)
    saved = { ...saved, ...fields, revision: saved.revision + 1, issues: [...issueMap.values()] }
    const { issues: _issues, ...update } = saved
    for (const callback of listeners) callback({ ...update, issueChanges: changes })
  }
  const issue = (songId: number, message: string): NonNullable<AudioIntegrityProgress['issues'][number]> => ({ songId, title: `问题歌曲 ${songId}`, fileName: `bad-${songId}.flac`, kind: 'problem', message })
  try {
    flushSync(() => root.render(<AudioIntegritySettings key="first" />))
    await waitFor(() => !host.querySelector('button')!.disabled)
    host.querySelector('button')!.click()
    await waitFor(() => host.innerText.includes('停止检查'))
    send({ completed: 3, scanned: 3, phase: 'decoding', currentSong: { songId: 4, title: '正在检查的歌', fileName: 'file.flac' } }, [{ songId: 6, issue: issue(6, 'existing issue from snapshot') }])
    await waitFor(() => host.innerText.includes('3 / 10'))
    flushSync(() => root.render(null))
    check(listeners.size === 0 && stops === 0, 'Navigation must unsubscribe without stopping the scan')
    const old = structuredClone(saved)
    delaySnapshot = true
    flushSync(() => root.render(<AudioIntegritySettings key="second" />))
    await waitFor(() => !!lateResolve)
    send({ completed: 7, scanned: 5, skipped: 2 }, [{ songId: 8, issue: issue(8, 'issue added during snapshot') }])
    send({ completed: 8, scanned: 6, skipped: 2 }, [{ songId: 9, issue: issue(9, 'issue retained after snapshot') }])
    send({}, [{ songId: 8, issue: null }])
    lateResolve!(old)
    await waitFor(() => host.innerText.includes('8 / 10') && host.innerText.includes('issue retained after snapshot'))
    check(!host.innerText.includes('issue added during snapshot'), 'Pending issue removal was not replayed after a stale snapshot')
    check(host.innerText.includes('existing issue from snapshot'), 'Incremental updates discarded historical issues from the snapshot')
    const { issues: _issues, ...stale } = old
    for (const callback of listeners) callback({ ...stale, issueChanges: [{ songId: 9, issue: null }] })
    send({}, [{ songId: 6, issue: null }])
    await waitFor(() => !host.innerText.includes('existing issue from snapshot'))
    check(host.innerText.includes('issue retained after snapshot'), 'Outdated issue delta overrode newer diagnostics')
    check(starts === 1 && host.querySelector('progress')?.value === 8, 'Old snapshot overwrote live state or remount started another task')
    host.querySelector('button')!.click()
    await waitFor(() => host.innerText.includes('正在停止'))
    check(stops === 1, 'Stop was not requested once')
    send({ status: 'completed', completed: 10, currentSong: null })
    await waitFor(() => host.innerText.includes('issue retained after snapshot'))
    check(host.querySelectorAll('[aria-label="存在问题的歌曲"] li').length === 1, 'Issue delta incorrectly sent or retained unrelated issues')
    flushSync(() => root.render(null))
    delaySnapshot = false
    flushSync(() => root.render(<AudioIntegritySettings key="third" />))
    await waitFor(() => host.innerText.includes('issue retained after snapshot'))
    check(host.querySelectorAll('[aria-label="存在问题的歌曲"] li').length === 1, 'Returning to Inspect did not restore the full issue snapshot')
    flushSync(() => root.render(null))
    flushSync(() => root.render(<ToolsView />))
    await waitFor(() => host.innerText.includes('Playlist') && host.innerText.includes('音频标签'))
    check(!host.innerText.includes('存储位置') && !host.innerText.includes('音乐库检查'), 'Tools contains unrelated groups')
    flushSync(() => root.render(<SettingsView />))
    await waitFor(() => host.innerText.includes('音频输出'))
    check(host.innerText.includes('无缝播放') && host.innerText.includes('存储位置'), 'Settings is missing playback or storage')
    check(!host.innerText.includes('Playlist') && !host.innerText.includes('音乐库检查'), 'Settings still contains moved tools')
    flushSync(() => root.render(<InspectView />))
    await waitFor(() => host.innerText.includes('issue retained after snapshot'))
    check(host.innerText.includes('音乐库检查') && host.innerText.includes('打开终端'), 'Inspect is missing old checks/database')
    check(!host.innerText.includes('一键写入') && !host.innerText.includes('存储位置'), 'Inspect contains unrelated groups')
    return ['Task navigation unsubscribes without stopping; stale snapshots replay issue additions/removals by revision; remount restores complete diagnostics', 'Tools / Inspect / Settings contain their intended sections']
  } finally { root.unmount(); host.remove() }
}
export const result = run()
