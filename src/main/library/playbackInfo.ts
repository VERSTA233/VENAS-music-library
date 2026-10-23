import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseFile } from 'music-metadata'
import type { PlaybackFileInfo } from '../../shared/types'
import type { LibraryPaths } from './paths'
import { resolveMigratedAppendSource, resolveMigratedMusicSource } from './migratedAppendSources'

export async function inspectPlaybackFile(paths: LibraryPaths, mediaUrl: string): Promise<PlaybackFileInfo> {
  const url = new URL(mediaUrl)
  const name = decodeURIComponent(url.pathname.slice(1))
  if (url.protocol !== 'venas-media:' || !['music', 'append'].includes(url.hostname) || !name || name === '.' || name === '..' || basename(name) !== name || /[/\\]/.test(name)) {
    throw new Error('音频地址无效')
  }
  const migrated = url.hostname === 'append' ? resolveMigratedAppendSource(name) : resolveMigratedMusicSource(name)
  const file = join(url.hostname === 'append' && !migrated ? paths.append : paths.music, migrated ?? name)
  const info = await stat(file)
  const version = `${info.size}:${info.mtimeMs}`
  /* 大文件直接使用流式播放，不为内存预检再完整扫描一遍。 */
  if (info.size > 128 * 1024 * 1024) return { size: info.size, version, duration: null, sampleRate: null, channels: null }
  const metadata = await parseFile(file, { duration: true, skipCovers: true })
  return {
    size: info.size, version,
    duration: metadata.format.duration ?? null,
    sampleRate: metadata.format.sampleRate ?? null,
    channels: metadata.format.numberOfChannels ?? null
  }
}
