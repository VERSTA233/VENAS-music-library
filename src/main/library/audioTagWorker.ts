import { parentPort, workerData } from 'node:worker_threads'
import { chmod, copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFlacTagCopy } from './flacTags'
import { inspectNativeAudio, verifyNativeValues, type NativeTagFormat } from './audioTagIntegrity'
import { hashAudioFile, isSameAudioFile } from './audioFileHash'

export interface AudioTagWork {
  songId: number
  source: string
  sourceHash: string
  values: Record<string, string>
  binary: string
}

async function syncDirectory(path: string): Promise<void> {
  // Windows 不支持目录 fsync；文件本身仍在 rename 前强制落盘。
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function run(work: AudioTagWork): Promise<string> {
  const { source, values } = work
  const directory = join(dirname(source), `.venas-tag-write-${work.songId}`)
  const manifest = { version: 1, songId: work.songId, fileName: basename(source) }
  const files = ['prepared.bin', 'values.bin', 'original.bin', 'manifest.pending', 'manifest.json']
  const cleanup = async (): Promise<void> => {
    for (const file of files) await unlink(join(directory, file)).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rmdir(directory)
  }
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error('写入暂存目录不安全')
    const entries = await readdir(directory)
    const interruptedManifest = entries.length === 1 && entries[0] === 'manifest.pending'
    const saved = entries.length && !interruptedManifest ? JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) : manifest
    if (JSON.stringify(saved) !== JSON.stringify(manifest) || entries.some(file => !files.includes(file))) throw new Error('发现未识别的暂存目录，请人工检查后重试')
    // 原文件从未先删除；原子替换前/后中断都可以从当前完整原文件重新生成。
    await cleanup()
    await mkdir(directory, { mode: 0o700 })
  }
  const manifestFile = await open(join(directory, 'manifest.pending'), 'wx', 0o600)
  try { await manifestFile.writeFile(JSON.stringify(manifest)); await manifestFile.sync() } finally { await manifestFile.close() }
  await rename(join(directory, 'manifest.pending'), join(directory, 'manifest.json'))
  await syncDirectory(directory)
  const prepared = join(directory, 'prepared.bin'), original = join(directory, 'original.bin')
  let committed = false, outputHash: string | undefined
  try {
    const before = await lstat(source)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('拒绝修改符号链接、硬链接或非普通音频文件')
    if (await hashAudioFile(source) !== work.sourceHash) throw new Error('音频文件已发生变化，请重试')
    // 硬链接保留旧 inode，不重复复制大文件，也不会中断已打开旧文件的播放器。
    await link(source, original)
    const linked = await lstat(source)
    const format = extname(source).slice(1).toLowerCase()
    parentPort?.postMessage({ phase: 'preparing' })
    if (format === 'flac') {
      await writeFlacTagCopy(source, prepared, values)
    } else {
      const nativeFormat = format as NativeTagFormat
      const clearAlbum = values.ALBUM === ''
      const beforeAudio = await inspectNativeAudio(source, nativeFormat, clearAlbum, false)
      await copyFile(source, prepared)
      const payload = Buffer.concat(Object.entries(values).flatMap(([key, value]) => [key, value].flatMap(text => {
        const bytes = Buffer.from(text), length = Buffer.alloc(4); length.writeUInt32LE(bytes.length)
        return [length, bytes]
      })))
      const valueFile = join(directory, 'values.bin')
      await writeFile(valueFile, payload, { flag: 'wx', mode: 0o600 })
      await promisify(execFile)(work.binary, [format, prepared, '--values-file', valueFile], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })
      parentPort?.postMessage({ phase: 'validating' })
      const afterAudio = await inspectNativeAudio(prepared, nativeFormat, clearAlbum)
      verifyNativeValues(nativeFormat, afterAudio.values, values)
      if (beforeAudio.audioHash !== afterAudio.audioHash || beforeAudio.picturesHash !== afterAudio.picturesHash) throw new Error('音频或内嵌封面校验失败，未替换原文件')
    }
    parentPort?.postMessage({ phase: 'validating' })
    await chmod(prepared, before.mode & 0o777)
    await utimes(prepared, before.atime, before.mtime)
    const file = await open(prepared, 'r+')
    try { await file.sync() } finally { await file.close() }
    outputHash = await hashAudioFile(prepared)
    const current = await lstat(source)
    if (!isSameAudioFile(current, linked) || current.nlink !== 2 || await hashAudioFile(source) !== work.sourceHash) throw new Error('提交前原文件发生变化，未覆盖')
    parentPort?.postMessage({ phase: 'committing' })
    await syncDirectory(directory)
    await rename(prepared, source)
    committed = true
    await syncDirectory(dirname(source))
    if (await hashAudioFile(source) !== outputHash) throw new Error('提交后文件哈希校验失败')
    await cleanup()
    return outputHash
  } catch (error) {
    if (committed) {
      // 仅当目标仍是本次写入的结果才回滚，避免覆盖外部编辑。
      if (await lstat(original).catch(() => null) && await hashAudioFile(source).catch(() => null) === outputHash) {
        await rename(original, source)
        await syncDirectory(dirname(source))
        await cleanup()
      }
      // 无法安全回滚时保留 original.bin，供人工恢复；不记为成功。
    } else await cleanup()
    throw error
  }
}

if (parentPort) {
  void run(workerData as AudioTagWork).then(
    fileHash => parentPort!.postMessage({ fileHash }),
    error => { parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
  )
}
