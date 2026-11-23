import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AudioOutputSettings from '../src/renderer/src/components/AudioOutputSettings'
import type { AudioOutputSettings as AudioOutputState, MacAudioBackend } from '../src/shared/types'

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 4000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}; ${document.body.innerText}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
function check(value: boolean, label: string): void { if (!value) throw new Error(label) }

async function run(): Promise<string[]> {
  let saved: AudioOutputState = { supported: true, selectedBackend: 'avfoundation', activeBackend: 'avfoundation', launchOverride: false }
  let failSave = false
  let writes = 0
  window.api = { playback: {
    getAudioOutput: async () => ({ ...saved }),
    setAudioOutput: async (backend: MacAudioBackend) => {
      writes++
      if (failSave) throw new Error('Test save failure')
      saved = { ...saved, selectedBackend: backend }
      return { ...saved }
    }
  } } as never
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let revision = 0
  const mount = (): void => flushSync(() => root.render(<AudioOutputSettings key={revision++} />))
  const trigger = (): HTMLButtonElement | null => host.querySelector('button[aria-haspopup="menu"]')
  const selected = (value: MacAudioBackend): boolean => trigger()?.textContent === (value === 'avfoundation' ? 'AVFoundation' : 'AUHAL / Core Audio')
  const choose = async (value: MacAudioBackend): Promise<void> => {
    trigger()!.click()
    await waitFor(() => !!host.querySelector('[role="menu"]'), 'open backend menu')
    const option = host.querySelector<HTMLButtonElement>(`button[value="${value}"]`)!
    check(option.getAttribute('aria-checked') === String(selected(value)), 'Menu selection does not match saved value')
    option.click()
  }
  try {
    mount()
    await waitFor(() => selected('avfoundation'), 'initial selection')
    await choose('auhal')
    await waitFor(() => selected('auhal') && !!host.querySelector('[role="status"]'), 'saved choice requires restart')
    check(saved.activeBackend === 'avfoundation', 'Saving incorrectly changed the running backend')
    check(saved.selectedBackend === 'auhal' && writes === 1, 'Choice not saved exactly once')
    mount()
    await waitFor(() => selected('auhal') && !!host.querySelector('[role="status"]'), 'saved choice restored after remount')
    await choose('avfoundation')
    await waitFor(() => selected('avfoundation') && !host.querySelector('[role="status"]'), 'cancel pending switch')
    failSave = true
    await choose('auhal')
    await waitFor(() => !!host.querySelector('[role="alert"]'), 'save failure')
    check(selected('avfoundation') && saved.selectedBackend === 'avfoundation', 'Failed save left an unsaved selection checked')
    failSave = false
    saved = { ...saved, selectedBackend: 'auhal', activeBackend: 'auhal' }
    mount()
    await waitFor(() => selected('auhal'), 'restart applies saved backend')
    check(!host.querySelector('[role="status"]'), 'Applied backend still shows pending restart')
    saved = { ...saved, selectedBackend: 'avfoundation', launchOverride: true }
    mount()
    await waitFor(() => host.innerText.includes('启动参数覆盖'), 'launch argument override explanation')
    saved = { ...saved, supported: false, activeBackend: null, launchOverride: false }
    mount()
    await new Promise((resolve) => setTimeout(resolve, 30))
    check(host.childElementCount === 0, 'macOS-only setting is visible on another platform')
    return ['Compact audio backend menu saves and survives remount, indicates restart when needed, and can cancel a pending switch',
      'Save failures retain the last saved selection; restart, launch overrides and unsupported platforms display correctly']
  } finally { root.unmount(); host.remove() }
}

export const result = run()
