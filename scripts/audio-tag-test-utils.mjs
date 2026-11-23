import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function compileTestWriter(directory) {
  const flags = execFileSync('taglib-config', ['--cflags', '--libs'], { encoding: 'utf8' }).trim().split(/\s+/)
  const binary = join(directory, 'audio-tag-writer')
  execFileSync('c++', ['-std=c++17', fileURLToPath(new URL('./audio-tag-writer.cpp', import.meta.url)), ...flags, ...(process.platform === 'win32' ? ['-lshell32'] : []), '-o', binary], { stdio: 'pipe' })
  return binary
}

export { syncsafe, wavChunks, id3Frames, frameText, inspectId3Tags, encodedMediaHash, oggPackets, mp4Atoms, inspectMp4Tags } from '../src/main/library/audioTagInspection.mjs'

export function decodeHash(file) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s32le', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8', timeout: 60000 })
  if (result.error) throw result.error
  if (result.status !== 0 || !/^SHA256=[0-9a-f]{64}$/.test(result.stdout.trim())) throw new Error(`解码校验失败：${result.stderr}`)
  return { hash: result.stdout.trim(), warnings: result.stderr.trim().replace(/0x[0-9a-f]+/gi, '<address>') }
}

