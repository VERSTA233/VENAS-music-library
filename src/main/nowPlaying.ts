import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { NowPlayingState, RemoteCommand } from '../shared/types'

interface NativeNowPlaying {
  initialize: (callback: (command: RemoteCommand) => void) => void
  update: (state: NowPlayingState | null) => void
  dispose: () => void
}

const requireNative = createRequire(import.meta.url)

export function startNowPlaying(onCommand: (command: RemoteCommand) => void): {
  update: (state: NowPlayingState | null) => void
  dispose: () => void
} {
  if (process.platform !== 'darwin') return { update: () => undefined, dispose: () => undefined }
  const path = join(app.isPackaged ? process.resourcesPath : app.getAppPath() + '/resources', 'native-media', 'venas-media.node')
  let native: NativeNowPlaying
  try {
    native = requireNative(path) as NativeNowPlaying
    native.initialize(onCommand)
  } catch (error) {
    console.warn('[VENAS playback] macOS Now Playing unavailable', error)
    return { update: () => undefined, dispose: () => undefined }
  }
  return { update: (state) => native.update(state), dispose: () => native.dispose() }
}
