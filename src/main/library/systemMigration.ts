import { createHash, randomUUID } from 'node:crypto'
import { cpSync, createReadStream, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { LibraryPaths } from './paths'

interface TreeEntry {
  type: 'directory' | 'file'
  size: number
  path: string
}

/* 复制系统目录到同一目标卷的临时路径，逐文件校验 SHA-256 后才原子命名为 .system。 */
export async function copyAndVerifySystemDirectory(paths: LibraryPaths, newSystemRoot: string): Promise<string> {
  const finalDirectory = join(newSystemRoot, '.system')
  if (existsSync(finalDirectory)) throw new Error('目标目录下已存在 .system 文件夹，请另选一个目录')

  const temporaryDirectory = join(newSystemRoot, `.system.migrating-${randomUUID()}`)
  try {
    cpSync(paths.system, temporaryDirectory, { recursive: true, errorOnExist: true })
    await verifyDirectoryCopy(paths.system, temporaryDirectory)
    renameSync(temporaryDirectory, finalDirectory)
    return finalDirectory
  } catch (error) {
    if (existsSync(temporaryDirectory)) rmSync(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

async function verifyDirectoryCopy(source: string, target: string): Promise<void> {
  const sourceEntries = collectTree(source)
  const targetEntries = collectTree(target)
  if (sourceEntries.size !== targetEntries.size) throw new Error('系统目录复制校验失败：文件数量不一致')

  for (const [relativePath, sourceEntry] of sourceEntries) {
    const targetEntry = targetEntries.get(relativePath)
    if (!targetEntry || targetEntry.type !== sourceEntry.type || targetEntry.size !== sourceEntry.size) {
      throw new Error(`系统目录复制校验失败：${relativePath}`)
    }
    if (sourceEntry.type === 'file') {
      const [sourceHash, targetHash] = await Promise.all([sha256(sourceEntry.path), sha256(targetEntry.path)])
      if (sourceHash !== targetHash) throw new Error(`系统目录复制校验失败：${relativePath} 的内容不一致`)
    }
  }
}

function collectTree(root: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>()
  function walk(directory: string): void {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      const key = relative(root, path)
      if (item.isDirectory()) {
        entries.set(key, { type: 'directory', size: 0, path })
        walk(path)
      } else if (item.isFile()) {
        entries.set(key, { type: 'file', size: statSync(path).size, path })
      } else {
        throw new Error(`系统目录包含不支持的特殊文件：${key}`)
      }
    }
  }
  walk(root)
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
