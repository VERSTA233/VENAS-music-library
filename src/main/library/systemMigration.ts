import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { LibraryPaths } from './paths'
import type { LibraryMaintenanceState } from '../../shared/types'

interface TreeEntry {
  type: 'directory' | 'file'
  size: number
  path: string
}

/* 复制系统目录到同一目标卷的临时路径，逐文件校验 SHA-256 后才原子命名为 .system。 */
export async function copyAndVerifySystemDirectory(
  paths: LibraryPaths,
  newSystemRoot: string,
  onProgress: (state: LibraryMaintenanceState) => void = () => {}
): Promise<string> {
  const finalDirectory = join(newSystemRoot, '.system')
  if (existsSync(finalDirectory)) throw new Error('目标目录下已存在 .system 文件夹，请另选一个目录')

  const temporaryDirectory = join(newSystemRoot, `.system.migrating-${randomUUID()}`)
  try {
    onProgress({ phase: 'copying', completed: 0, total: 0 })
    const entries = await collectTree(paths.system)
    const total = [...entries.values()].filter((entry) => entry.type === 'file').length
    let completed = 0
    await mkdir(temporaryDirectory)
    onProgress({ phase: 'copying', completed, total })
    for (const [relativePath, entry] of entries) {
      const target = join(temporaryDirectory, relativePath)
      if (entry.type === 'directory') await mkdir(target)
      else {
        await copyFile(entry.path, target, constants.COPYFILE_EXCL)
        onProgress({ phase: 'copying', completed: ++completed, total })
      }
    }
    await verifyDirectoryCopy(paths.system, temporaryDirectory, onProgress)
    await rename(temporaryDirectory, finalDirectory)
    return finalDirectory
  } catch (error) {
    if (existsSync(temporaryDirectory)) await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

async function verifyDirectoryCopy(source: string, target: string, onProgress: (state: LibraryMaintenanceState) => void): Promise<void> {
  onProgress({ phase: 'verifying', completed: 0, total: 0 })
  const sourceEntries = await collectTree(source)
  const targetEntries = await collectTree(target)
  const total = [...sourceEntries.values()].filter((entry) => entry.type === 'file').length
  let completed = 0
  onProgress({ phase: 'verifying', completed, total })
  if (sourceEntries.size !== targetEntries.size) throw new Error('系统目录复制校验失败：文件数量不一致')

  for (const [relativePath, sourceEntry] of sourceEntries) {
    const targetEntry = targetEntries.get(relativePath)
    if (!targetEntry || targetEntry.type !== sourceEntry.type || targetEntry.size !== sourceEntry.size) {
      throw new Error(`系统目录复制校验失败：${relativePath}`)
    }
    if (sourceEntry.type === 'file') {
      const [sourceHash, targetHash] = await Promise.all([sha256(sourceEntry.path), sha256(targetEntry.path)])
      if (sourceHash !== targetHash) throw new Error(`系统目录复制校验失败：${relativePath} 的内容不一致`)
      onProgress({ phase: 'verifying', completed: ++completed, total })
    }
  }
}

async function collectTree(root: string): Promise<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>()
  async function walk(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      const key = relative(root, path)
      if (item.isDirectory()) {
        entries.set(key, { type: 'directory', size: 0, path })
        await walk(path)
      } else if (item.isFile()) {
        entries.set(key, { type: 'file', size: (await stat(path)).size, path })
      } else {
        throw new Error(`系统目录包含不支持的特殊文件：${key}`)
      }
    }
  }
  await walk(root)
  return entries
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
