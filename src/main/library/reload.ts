import { constants, copyFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { LibraryPaths } from './paths'
import { getDatabase } from '../db'
import { getSongDetail, updateSongFields } from '../db/queries/songs'
import { updateSongCover } from './coverCache'
import { recordMigratedMusicSource } from './migratedAppendSources'
import type { ReloadResult } from '../../shared/types'

export type { ReloadResult }

export class ReloadError extends Error {}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.ape'])

function normalizeTargetFileName(source: string): string {
  const fileName = source.trim()
  if (!fileName || fileName === '.' || fileName === '..' || basename(fileName) !== fileName || /[/\\]/.test(fileName)) {
    throw new ReloadError('文件名不能为空，也不能包含路径分隔符')
  }
  if (!AUDIO_EXTENSIONS.has(extname(fileName).toLowerCase())) {
    throw new ReloadError('文件名必须保留受支持的音频扩展名')
  }
  return fileName
}

function pathsReferToSameFile(left: string, right: string): boolean {
  if (left === right) return true
  if (!existsSync(left) || !existsSync(right)) return false
  const leftStat = statSync(left)
  const rightStat = statSync(right)
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
}

/* rename 无法跨卷移动；这种情况下先完整复制并校验大小，再删除源文件。 */
function moveFile(sourcePath: string, targetPath: string): void {
  try {
    renameSync(sourcePath, targetPath)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }

  copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL)
  try {
    if (statSync(sourcePath).size !== statSync(targetPath).size) {
      throw new ReloadError('跨磁盘移动后的文件大小校验失败')
    }
    unlinkSync(sourcePath)
  } catch (error) {
    if (existsSync(targetPath)) unlinkSync(targetPath)
    throw error
  }
}

function stagingPath(paths: LibraryPaths, songId: number, fileName: string): string {
  let attempt = 0
  let path: string
  do {
    path = join(paths.music, `.${songId}.${Date.now()}.${attempt}.${fileName}.reloading`)
    attempt += 1
  } while (existsSync(path))
  return path
}

/*
 * 重命名歌曲音频，或把任意位置选中的音频移动进 Music/ 并替换旧文件。
 * 旧文件先暂存，文件与数据库都成功后再删除；任一步失败都会尽力恢复原路径。
 */
export async function reloadAudioFile(
  paths: LibraryPaths,
  songId: number,
  replacementFilePath: string | null,
  targetFileName: string,
  updateMetadata: () => void = () => {}
): Promise<ReloadResult> {
  const db = getDatabase()
  const song = getSongDetail(db, songId)
  if (!song) throw new ReloadError('歌曲不存在')

  const oldFileName = song.file_name
  const oldPath = join(paths.music, oldFileName)
  const finalFileName = normalizeTargetFileName(targetFileName)
  const finalPath = join(paths.music, finalFileName)
  if (replacementFilePath == null && finalFileName === oldFileName) {
    db.transaction(() => {
      updateSongFields(db, songId, { file_name: finalFileName })
      updateMetadata()
    })()
    return { coverCacheFailed: false, fileName: finalFileName, audioReplaced: false }
  }
  const sourcePath = replacementFilePath == null ? oldPath : resolve(replacementFilePath)
  const sourceFileName = basename(sourcePath)
  if (replacementFilePath != null && !isAbsolute(replacementFilePath)) throw new ReloadError('所选音频路径无效')
  if (!existsSync(sourcePath)) throw new ReloadError(replacementFilePath ? '所选文件不存在' : '当前音频文件不存在')

  const replacementIsOldFile = pathsReferToSameFile(sourcePath, oldPath)
  const replacing = replacementFilePath != null && !replacementIsOldFile
  const sourceExtension = extname(sourceFileName).toLowerCase()
  const oldExtension = extname(oldFileName).toLowerCase()
  const finalExtension = extname(finalFileName).toLowerCase()
  if (finalExtension !== (replacing ? sourceExtension : oldExtension)) {
    throw new ReloadError('文件扩展名必须与实际音频格式保持一致')
  }
  const sourceRelative = relative(paths.music, sourcePath)
  const sourceIsMusicRootFile = !isAbsolute(sourceRelative) && !sourceRelative.startsWith('..') && basename(sourceRelative) === sourceRelative
  if (replacing && sourceIsMusicRootFile) {
    const sourceOwner = db
      .prepare<[string, number], { id: number }>('SELECT id FROM songs WHERE file_name = ? AND id <> ?')
      .get(sourceRelative, songId)
    if (sourceOwner) throw new ReloadError('所选文件已经关联到另一首歌曲')
  }
  const targetOwner = db
    .prepare<[string, number], { id: number }>('SELECT id FROM songs WHERE file_name = ? AND id <> ?')
    .get(finalFileName, songId)
  if (targetOwner) throw new ReloadError('该文件名已被另一首歌曲使用')
  if (existsSync(finalPath) && !pathsReferToSameFile(finalPath, oldPath) && !pathsReferToSameFile(finalPath, sourcePath)) {
    throw new ReloadError(`Music 中已存在文件：${finalFileName}`)
  }

  let length: number | null | undefined
  let cover: Buffer | null = null
  if (replacing) {
    const { parseFile } = await import('music-metadata')
    const metadata = await parseFile(sourcePath)
    length = metadata.format.duration ? Math.round(metadata.format.duration) : null
    cover = metadata.common.picture?.[0] ? Buffer.from(metadata.common.picture[0].data) : null
  }

  const caseOnlyRename = !replacing && oldFileName !== finalFileName && oldFileName.toLocaleLowerCase() === finalFileName.toLocaleLowerCase()
  const stagePath = stagingPath(paths, songId, oldFileName)
  let oldStaged = false
  let sourceMoved = false
  try {
    if ((replacing || caseOnlyRename) && existsSync(oldPath)) {
      renameSync(oldPath, stagePath)
      oldStaged = true
    }
    const effectiveSourcePath = caseOnlyRename ? stagePath : sourcePath
    if (!pathsReferToSameFile(effectiveSourcePath, finalPath)) {
      moveFile(effectiveSourcePath, finalPath)
      sourceMoved = true
    }

    db.transaction(() => {
      updateSongFields(db, songId, {
        ...(length !== undefined ? { length } : {}),
        file_name: finalFileName
      })
      updateMetadata()
    })()
  } catch (error) {
    if (sourceMoved && existsSync(finalPath)) moveFile(finalPath, caseOnlyRename ? stagePath : sourcePath)
    if (oldStaged && existsSync(stagePath)) renameSync(stagePath, oldPath)
    throw error
  }

  if (oldStaged && existsSync(stagePath)) {
    try {
      unlinkSync(stagePath)
    } catch {
      /* 数据库与新音频已提交，旧文件清理失败不应把已成功的保存伪装成失败。 */
    }
  }

  let coverCacheFailed = false
  if (replacing && cover) {
    try {
      await updateSongCover(paths, db, songId, cover)
    } catch {
      coverCacheFailed = true
    }
  } else if (replacing) {
    coverCacheFailed = true
  }

  if (!replacing) recordMigratedMusicSource(oldFileName, finalFileName)
  return { coverCacheFailed, fileName: finalFileName, audioReplaced: replacing }
}

/* 用户手动上传一张图片作为指定歌曲的封面（manual=true：属于专辑时总是覆盖专辑封面） */
export async function setManualCover(paths: LibraryPaths, songId: number, imageData: Buffer): Promise<void> {
  const db = getDatabase()
  await updateSongCover(paths, db, songId, imageData, { manual: true })
}
