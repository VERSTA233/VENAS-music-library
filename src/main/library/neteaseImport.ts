import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { basename, extname, join, parse } from 'node:path'
import { promisify } from 'node:util'
import type { NeteaseImportResult } from '../../shared/types'
import type { LibraryPaths } from './paths'

const execFileAsync = promisify(execFile)
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac'])

interface PendingFile {
  name: string
  path: string
}

/* 只移动网易云目录的根层文件。重名时生成新文件名，绝不覆盖 Append 中现有内容。 */
function nextAvailablePath(directory: string, fileName: string): string {
  const parsed = parse(fileName)
  let suffix = 0
  let candidate = join(directory, fileName)
  while (existsSync(candidate)) {
    suffix += 1
    candidate = join(directory, `${parsed.name} (${suffix})${parsed.ext}`)
  }
  return candidate
}

/* rename 跨文件系统失败时复制并校验大小，完成后才删除源文件。 */
function moveFile(sourcePath: string, targetPath: string): void {
  try {
    renameSync(sourcePath, targetPath)
    return
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV') throw error
  }

  copyFileSync(sourcePath, targetPath, 0)
  if (statSync(sourcePath).size !== statSync(targetPath).size) {
    rmSync(targetPath, { force: true })
    throw new Error('复制校验失败，源文件已保留')
  }
  unlinkSync(sourcePath)
}

function rootFiles(directory: string): PendingFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }))
}

function findDecodedAudio(directory: string): string | null {
  const files = rootFiles(directory).filter((file) => AUDIO_EXTENSIONS.has(extname(file.name).toLowerCase()))
  if (files.length !== 1) return null
  return files[0].path
}

/* 解码根层 NCM，并同步移动根层 MP3、FLAC 与 LRC 到 Append。单个文件失败不会中断后续文件。 */
export async function importNeteaseMusic(paths: LibraryPaths, sourceDirectory: string | null): Promise<NeteaseImportResult> {
  if (!sourceDirectory) throw new Error('请先在设置中选择网易云音乐目录')
  if (!existsSync(sourceDirectory)) throw new Error('网易云音乐目录不存在，请在设置中重新选择')
  if (!statSync(sourceDirectory).isDirectory()) throw new Error('网易云音乐路径不是文件夹，请在设置中重新选择')
  if (!existsSync(paths.ncmdump)) throw new Error('找不到 .system/tools/ncmdump 解码工具')

  const sourceFiles = rootFiles(sourceDirectory)
  const result: NeteaseImportResult = { audioFiles: [], failedFiles: [] }
  const renamedAudioStems = new Map<string, string>()

  for (const source of sourceFiles.filter((file) => extname(file.name).toLowerCase() === '.ncm')) {
    const temporaryDirectory = mkdtempSync(join(paths.tools, '.ncmdump-'))
    try {
      await execFileAsync(paths.ncmdump, ['--output', temporaryDirectory, source.path])
      const decodedPath = findDecodedAudio(temporaryDirectory)
      if (!decodedPath) throw new Error('解码工具没有生成唯一的 MP3 或 FLAC 文件')
      const targetPath = nextAvailablePath(paths.append, basename(decodedPath))
      moveFile(decodedPath, targetPath)
      unlinkSync(source.path)
      result.audioFiles.push(basename(targetPath))
      renamedAudioStems.set(parse(source.name).name, parse(basename(targetPath)).name)
    } catch (error) {
      result.failedFiles.push({
        fileName: source.name,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }

  for (const source of sourceFiles.filter((file) => AUDIO_EXTENSIONS.has(extname(file.name).toLowerCase()))) {
    try {
      const targetPath = nextAvailablePath(paths.append, source.name)
      moveFile(source.path, targetPath)
      result.audioFiles.push(basename(targetPath))
      renamedAudioStems.set(parse(source.name).name, parse(basename(targetPath)).name)
    } catch (error) {
      result.failedFiles.push({
        fileName: source.name,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  for (const source of sourceFiles.filter((file) => extname(file.name).toLowerCase() === '.lrc')) {
    try {
      const mappedStem = renamedAudioStems.get(parse(source.name).name)
      const targetName = mappedStem ? `${mappedStem}.lrc` : source.name
      moveFile(source.path, nextAvailablePath(paths.append, targetName))
    } catch (error) {
      result.failedFiles.push({
        fileName: source.name,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return result
}
