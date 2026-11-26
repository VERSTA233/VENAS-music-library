import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { windowsDatabaseTerminal } from '../src/main/databaseTerminal'
import { libraryPaths } from '../src/main/library/paths'

test('Windows database terminal passes Unicode and shell characters as data, not code', () => {
  const binary = String.raw`D:\工具 & 音乐\sqlite3.exe`
  const database = String.raw`D:\Music\O'Brien $([bad]) %PATH% & ;\music.db`
  const launch = windowsDatabaseTerminal(binary, database, { SystemRoot: 'C:\\Windows', PATH: 'preserved' })
  assert.equal(launch.command, String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
  assert.deepEqual(launch.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  const launcher = Buffer.from(launch.args[4], 'base64').toString('utf16le')
  const session = launcher.match(/'-EncodedCommand', '([A-Za-z0-9+/=]+)'/)![1]
  assert.match(launcher, /^Start-Process /)
  assert.ok(launcher.includes("'-NoExit'"))
  assert.equal(Buffer.from(session, 'base64').toString('utf16le'), '& $env:VENAS_SQLITE_EXE $env:VENAS_DATABASE_FILE')
  assert.equal(launch.options.env.VENAS_SQLITE_EXE, binary)
  assert.equal(launch.options.env.VENAS_DATABASE_FILE, database)
  assert.equal(launch.options.env.PATH, 'preserved')
  assert.equal(launch.options.windowsHide, true)
})

test('NCM tool uses the correct executable on both platforms', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    for (const value of ['win32', 'darwin']) {
      Object.defineProperty(process, 'platform', { value })
      assert.ok(libraryPaths('/music', '/system').ncmdump.endsWith(value === 'win32' ? 'ncmdump.exe' : 'ncmdump'))
    }
  } finally { Object.defineProperty(process, 'platform', platform) }
})

test('Media-remote build and IPC paths have been removed', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.ok(!JSON.stringify(pkg).includes('native-media'))
  for (const file of ['src/main/index.ts', 'src/preload/index.ts', 'src/renderer/src/playback/AudioEngine.tsx', 'src/shared/types.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /NowPlaying|RemoteCommand|remoteCommand|native-media/)
  }
})
