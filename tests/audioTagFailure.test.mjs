import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { writeFlacTagCopy } from '../src/main/library/flacTags.ts'

const worker = resolve('tests/audioTagFailureWorker.mjs')
const hash = data => createHash('sha256').update(data).digest('hex')
async function fileHash(path) { return hash(await readFile(path)) }
function fixtureBytes() {
  const metadata = Buffer.alloc(42)
  metadata.write('fLaC'); metadata[4] = 0x80; metadata.writeUIntBE(34, 5, 3)
  return Buffer.concat([metadata, Buffer.alloc(4 * 1024 * 1024, 0x5a)])
}
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'venas-tag-failure-'))
  try {
    const source = join(directory, 'source.flac')
    await writeFile(source, fixtureBytes())
    await run({ directory, source, originalHash: await fileHash(source) })
  } finally { await rm(directory, { recursive: true, force: true }) }
}
function execute(args, checkpoint) {
  return new Promise((resolveRun, reject) => {
    const child = fork(worker, args, { execArgv: ['--experimental-strip-types'], silent: true })
    let stderr = '', stdout = '', reached = false
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Test child timed out')) }, 10000)
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('message', message => {
      if (checkpoint && message.stage === checkpoint) { reached = true; child.kill('SIGKILL') }
    })
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (checkpoint && !reached) reject(new Error(`Checkpoint not reached: ${checkpoint}; ${stderr}`))
      else resolveRun({ code, signal, stderr, stdout })
    })
  })
}
async function prepare(directory, source) {
  const backup = join(directory, 'original.flac'), prepared = join(directory, 'prepared.flac')
  await copyFile(source, backup)
  const result = await writeFlacTagCopy(source, prepared, { TITLE: 'Updated title' })
  const info = await lstat(source)
  const report = { source, original: backup, prepared, originalSha256: await fileHash(source), preparedSha256: await fileHash(prepared),
    result, mode: info.mode & 0o777, atime: info.atime.toISOString(), mtime: info.mtime.toISOString() }
  const reportPath = join(directory, 'report.json')
  await writeFile(reportPath, JSON.stringify(report))
  return { report, reportPath }
}
async function stagedFiles(directory) { return (await readdir(directory)).filter(name => name.startsWith('.venas-tag-test-')) }

for (const code of ['ENOSPC', 'EIO']) {
  test(`FLAC partial-write ${code}: original survives, incomplete output removed, retry succeeds`, () => fixture(async ({ source, directory, originalHash }) => {
    const output = join(directory, 'output.flac')
    const failed = await execute(['write', code, source, output])
    assert.equal(failed.code, 1); assert.match(failed.stderr, new RegExp(code))
    assert.equal(await fileHash(source), originalHash)
    await assert.rejects(lstat(output), { code: 'ENOENT' })
    await writeFlacTagCopy(source, output, { TITLE: 'Retry succeeded' })
    assert.equal(await fileHash(source), originalHash)
  }))
}

test('SIGKILL during FLAC writing leaves only a partial side file; original survives and unique-path retry succeeds', () => fixture(async ({ source, directory, originalHash }) => {
  const output = join(directory, 'interrupted.flac')
  const failed = await execute(['write', 'kill-write', source, output], 'partial-output')
  assert.equal(failed.signal, 'SIGKILL')
  assert.equal(await fileHash(source), originalHash)
  assert((await lstat(output)).size > 0)
  assert((await lstat(output)).size < (await lstat(source)).size)
  await assert.rejects(writeFlacTagCopy(source, output, { TITLE: 'Retry' }), { code: 'EEXIST' })
  await writeFlacTagCopy(source, join(directory, 'retry.flac'), { TITLE: 'Retry' })
  assert.equal(await fileHash(source), originalHash)
}))

test('apply refuses changed source, corrupt backup and corrupt prepared result without touching the target', () => fixture(async ({ directory, source }) => {
  const { report, reportPath } = await prepare(directory, source)
  for (const [path, expected] of [[source, /原文件已变化/], [report.original, /备份不完整/], [report.prepared, /测试结果已变化/]]) {
    const original = await readFile(path)
    await writeFile(path, Buffer.concat([original, Buffer.from('external edit')]))
    const currentSourceHash = await fileHash(source)
    const failed = await execute(['apply', 'none', reportPath, source])
    assert.equal(failed.code, 1); assert.match(failed.stderr, expected)
    assert.equal(await fileHash(source), currentSourceHash)
    assert.deepEqual(await stagedFiles(directory), [])
    await writeFile(path, original)
  }
}))

test('apply rename EACCES leaves original and backup intact, removes staging file, then retries successfully', () => fixture(async ({ directory, source, originalHash }) => {
  const { report, reportPath } = await prepare(directory, source)
  const failed = await execute(['apply', 'rename-fails', reportPath, source])
  assert.equal(failed.code, 1); assert.match(failed.stderr, /EACCES/)
  assert.equal(await fileHash(source), originalHash)
  assert.equal(await fileHash(report.original), originalHash)
  assert.deepEqual(await stagedFiles(directory), [])
  const retry = await execute(['apply', 'none', reportPath, source])
  assert.equal(retry.code, 0, retry.stderr)
  assert.equal(await fileHash(source), report.preparedSha256)
}))

test('staging fsync failure preserves source and backup and cleans staged output', () => fixture(async ({ directory, source, originalHash }) => {
  const { report, reportPath } = await prepare(directory, source)
  const failed = await execute(['apply', 'sync-fails', reportPath, source])
  assert.equal(failed.code, 1); assert.match(failed.stderr, /EIO/)
  assert.equal(await fileHash(source), originalHash)
  assert.equal(await fileHash(report.original), originalHash)
  assert.deepEqual(await stagedFiles(directory), [])
}))

test('external edits during staging are detected and preserved instead of being overwritten', () => fixture(async ({ directory, source, originalHash }) => {
  const before = await readFile(source)
  const { report, reportPath } = await prepare(directory, source)
  const failed = await execute(['apply', 'source-changes', reportPath, source])
  assert.equal(failed.code, 1); assert.match(failed.stderr, /提交前变化/)
  assert.deepEqual(await readFile(source), Buffer.concat([before, Buffer.from('External edit during staging')]))
  assert.equal(await fileHash(report.original), originalHash)
  assert.deepEqual(await stagedFiles(directory), [])
}))

for (const [mode, stage, committed] of [['kill-before-rename', 'before-rename', false], ['kill-after-rename', 'after-rename', true]]) {
  test(`${mode}: target is a complete ${committed ? 'new' : 'old'} file, backup survives`, () => fixture(async ({ directory, source, originalHash }) => {
    const { report, reportPath } = await prepare(directory, source)
    const result = await execute(['apply', mode, reportPath, source], stage)
    assert.equal(result.signal, 'SIGKILL')
    assert.equal(await fileHash(source), committed ? report.preparedSha256 : originalHash)
    assert.equal(await fileHash(report.original), originalHash)
    const staged = await stagedFiles(directory)
    assert.equal(staged.length, committed ? 0 : 1)
    if (!committed) {
      assert.equal(await fileHash(join(directory, staged[0])), report.preparedSha256)
      const retry = await execute(['apply', 'none', reportPath, source])
      assert.equal(retry.code, 0, retry.stderr)
      assert.equal(await fileHash(source), report.preparedSha256)
    }
  }))
}

test('missing source, existing output and source symlink are rejected without overwriting other files', () => fixture(async ({ directory, source, originalHash }) => {
  const { reportPath } = await prepare(directory, source)
  const output = join(directory, 'existing.flac')
  await writeFile(output, 'Keep existing file')
  await assert.rejects(writeFlacTagCopy(source, output, { TITLE: 'New' }), { code: 'EEXIST' })
  await assert.rejects(writeFlacTagCopy(join(directory, 'missing.flac'), join(directory, 'out.flac'), { TITLE: 'New' }), { code: 'ENOENT' })
  assert.equal(await readFile(output, 'utf8'), 'Keep existing file')
  const linkedDirectory = join(directory, 'linked'); await mkdir(linkedDirectory)
  const linkedSource = join(linkedDirectory, 'source.flac')
  await symlink(source, linkedSource)
  // 同时修正报告目标，确保拒绝原因是 symlink 而非路径不一致。
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  report.source = linkedSource
  await writeFile(reportPath, JSON.stringify(report))
  const failed = await execute(['apply', 'none', reportPath, linkedSource])
  assert.equal(failed.code, 1); assert.match(failed.stderr, /普通文件/)
  assert.equal(await fileHash(source), originalHash)
}))
