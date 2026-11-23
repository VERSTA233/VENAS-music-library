import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { libraryPaths } from '../src/main/library/paths'
import { inspectPlaybackFile, inspectPlaybackFormat } from '../src/main/library/playbackInfo'

test('source sample rate is read from WAV, FLAC and MP3 headers; invalid paths and audio are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'venas-format-'))
  try {
    const paths = libraryPaths(directory, directory)
    await mkdir(paths.music)
    await mkdir(paths.append)
    const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg'
    for (const [file, codec] of [['source.wav', 'pcm_s24le'], ['source.flac', 'flac'], ['source.mp3', 'libmp3lame']] as const) {
      const folder = file.endsWith('.flac') ? 'append' : 'music'
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.1', '-c:a', codec, join(paths[folder], file)])
      const url = `venas-media://${folder}/${file}`
      assert.deepEqual(await inspectPlaybackFormat(paths, url), { sampleRate: 44100 })
      const info = await inspectPlaybackFile(paths, url)
      assert.equal(info.sampleRate, 44100)
      assert.ok(info.duration! > 0)
    }
    await writeFile(join(paths.music, 'broken.flac'), 'invalid audio')
    await assert.rejects(inspectPlaybackFormat(paths, 'venas-media://music/broken.flac'))
    await assert.rejects(inspectPlaybackFormat(paths, 'venas-media://music/folder%2Fsource.wav'), /音频地址无效/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
