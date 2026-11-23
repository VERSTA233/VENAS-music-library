import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

/* 所有主进程测试共用临时目录、打包与原生模块解析；SQLite 使用 Electron 对应的 ABI。 */
const inspector = resolve('resources/audio-inspect', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const writer = resolve('resources/audio-tags', process.platform === 'win32' ? 'venas-tag-writer.exe' : 'venas-tag-writer')
const suites = {
  covers: [{ entry: 'tests/coverUpdates.test.ts' }],
  thumbnails: [{ entry: 'tests/thumbnailCache.test.ts', node: true }],
  'tag-ordering': [{ entry: 'tests/tagOrdering.test.ts', node: true }],
  'artist-ingest': [{ entry: 'tests/ingestArtistSelection.test.ts' }],
  'artist-aliases': [{ entry: 'tests/artistAliases.test.ts' }],
  'audio-integrity': [{ entry: 'tests/audioIntegrity.ts', test: false, args: directory => [directory, inspector] }],
  'audio-tag-writeback': [{ entry: 'tests/audioTagWriteback.ts', test: false, args: directory => [directory, resolve('out/main/audioTagWorker.js'), writer] }],
  playback: [{ entry: 'tests/playback.test.ts', node: true }, { entry: 'tests/playbackHistory.test.ts' }, { entry: 'tests/playbackFormat.test.ts' }],
  playlist: [{ entry: 'tests/playlistExport.test.ts' }]
}
const suite = process.argv[2]
if (!Object.hasOwn(suites, suite)) throw new Error(`Choose a test suite: ${Object.keys(suites).join(', ')}`)
const directory = await mkdtemp(join(tmpdir(), `venas-test-${suite}-`))
const require = createRequire(import.meta.url)
try {
  for (const [index, config] of suites[suite].entries()) {
    const file = join(directory, `${index}.cjs`)
    await build({ entryPoints: [config.entry], outfile: file, bundle: true, platform: 'node', format: 'cjs',
      plugins: [{ name: 'native-modules', setup(builder) {
        builder.onResolve({ filter: /^(better-sqlite3|sharp|music-metadata)$/ }, args => ({ path: require.resolve(args.path), external: true }))
      } }] })
    const result = spawnSync(config.node ? process.execPath : electron,
      [...(config.test === false ? [] : ['--test']), file, ...(config.args?.(directory) ?? [])], {
        stdio: 'inherit', timeout: 120000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: resolve('node_modules') }
      })
    if (result.error) throw result.error
    if (result.status !== 0) process.exitCode = result.status ?? 1
  }
} finally { await rm(directory, { recursive: true, force: true }) }
