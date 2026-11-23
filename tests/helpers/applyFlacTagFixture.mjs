import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, constants, copyFile, lstat, open, readFile, rename, unlink, utimes } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const [reportArgument, expectedFileArgument] = process.argv.slice(2)
if (!reportArgument || !expectedFileArgument) throw new Error('Failure-test fixture requires a report and target file')
const reportPath = resolve(reportArgument)
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const source = resolve(expectedFileArgument)
if (source !== report.source || !source.toLowerCase().endsWith('.flac')) throw new Error('测试文件与报告不一致')
if (resolve(report.original) !== join(dirname(reportPath), 'original.flac') || resolve(report.prepared) !== join(dirname(reportPath), 'prepared.flac')) {
  throw new Error('备份或测试文件位置无效')
}
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
const before = await lstat(source)
if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('测试目标必须是没有硬链接的普通文件')
if (await hashFile(report.original) !== report.originalSha256 || await hashFile(source) !== report.originalSha256) throw new Error('原文件已变化或备份不完整，取消替换')
if (await hashFile(report.prepared) !== report.preparedSha256) throw new Error('测试结果已变化，取消替换')
const temporary = join(dirname(source), `.venas-tag-test-${randomUUID()}.flac`)
let staged = false
try {
  /* 与目标放在同一目录，最后一次 rename 才提交；失败时原文件仍在，完整备份也保留。 */
  await copyFile(report.prepared, temporary, constants.COPYFILE_EXCL)
  staged = true
  await chmod(temporary, report.mode)
  await utimes(temporary, new Date(report.atime), new Date(report.mtime))
  const stagedFile = await open(temporary, 'r+')
  try { await stagedFile.sync() } finally { await stagedFile.close() }
  if (await hashFile(temporary) !== report.preparedSha256) throw new Error('复制后的校验失败，取消替换')
  const current = await lstat(source)
  if (current.ino !== before.ino || current.dev !== before.dev || await hashFile(source) !== report.originalSha256) throw new Error('原文件在提交前变化，取消替换')
  await rename(temporary, source)
  staged = false
  if (await hashFile(source) !== report.preparedSha256) throw new Error(`提交后的校验失败，原始备份保留在 ${report.original}`)
  console.log(JSON.stringify({ source, backup: report.original, report: reportPath, tags: report.result.tags,
    removedDescriptions: report.result.removedDescriptions, audioSha256: report.result.audioSha256,
    decodedAudioSha256: report.decodedAudioSha256, originalDecoderWarnings: report.originalDecoderWarnings,
    preservedMtime: report.mtime }, null, 2))
} finally {
  if (staged) await unlink(temporary).catch(() => undefined)
}
