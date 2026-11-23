import type { CommandLine } from 'electron'
import type { AudioOutputSettings, MacAudioBackend } from '../shared/types'

export type AudioOutputRuntime = Pick<AudioOutputSettings, 'activeBackend' | 'launchOverride'>

const MAC_PLAYBACK_FEATURE = 'MacAVFoundationPlayback'

/** AUHAL 在唤醒后固定推迟 Start() 5 秒，重建 AudioContext 无法绕过。
 * Chromium 150 内置的 AVFoundation 播放输出不经过该延迟；Web Audio 需使用 latencyHint: 'playback'。
 * https://github.com/chromium/chromium/blob/150.0.7871.47/media/audio/mac/audio_manager_mac.cc
 */
export function configureAudioOutput(
  commandLine: Pick<CommandLine, 'getSwitchValue' | 'appendSwitch'>,
  platform: NodeJS.Platform = process.platform,
  backend: MacAudioBackend = 'avfoundation'
): AudioOutputRuntime {
  if (platform !== 'darwin') return { activeBackend: null, launchOverride: false }
  const hasFeature = (value: string): boolean => value.split(',').some((feature) => feature.trim().split(/[<:]/, 1)[0] === MAC_PLAYBACK_FEATURE)
  // 保留用户传入的其它 Chromium 特性，并允许显式禁用以排查设备兼容性。
  if (hasFeature(commandLine.getSwitchValue('disable-features'))) return { activeBackend: 'auhal', launchOverride: true }
  const enabled = commandLine.getSwitchValue('enable-features')
  if (hasFeature(enabled)) return { activeBackend: 'avfoundation', launchOverride: true }
  const activeBackend = backend === 'auhal' ? 'auhal' : 'avfoundation'
  const switchName = activeBackend === 'auhal' ? 'disable-features' : 'enable-features'
  const existing = commandLine.getSwitchValue(switchName)
  commandLine.appendSwitch(switchName, [existing, MAC_PLAYBACK_FEATURE].filter(Boolean).join(','))
  return { activeBackend, launchOverride: false }
}
