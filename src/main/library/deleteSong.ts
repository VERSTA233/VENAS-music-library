import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
import type Database from 'better-sqlite3'
import type { LibraryPaths } from './paths'
import { deleteSong } from '../db/queries/songs'
import {
  addSongOrphanCandidates,
  cleanupOrphanCandidates,
  createOrphanCandidates,
  removeOrphanPictures,
  type OrphanCleanupResult
} from './orphanCleanup'

interface DeleteContext {
  fileName: string
}

/* 删除歌曲同时清理其音频、封面，以及删除后无引用的专辑和艺术家资料。 */
export function deleteLibrarySong(paths: LibraryPaths, db: Database.Database, songId: number): void {
  const context = getDeleteContext(db, songId)
  if (!context) throw new Error('歌曲不存在')

  const originalPath = musicFilePath(paths, context.fileName)
  const stagedPath = join(paths.music, `.${songId}.${Date.now()}.${context.fileName}.deleting`)
  let audioStaged = false
  if (existsSync(originalPath)) {
    renameSync(originalPath, stagedPath)
    audioStaged = true
  }

  const candidates = createOrphanCandidates()
  addSongOrphanCandidates(db, candidates, songId)
  let cleanupResult: OrphanCleanupResult = { albumIds: [], artistIds: [] }
  try {
    db.transaction(() => {
      deleteSong(db, songId)
      cleanupResult = cleanupOrphanCandidates(db, candidates)
    })()
  } catch (error) {
    if (audioStaged && existsSync(stagedPath)) renameSync(stagedPath, originalPath)
    throw error
  }

  removeIfExists(join(paths.assetsSongPictures, `${songId}.jpg`))
  removeOrphanPictures(paths, cleanupResult)
  if (audioStaged) removeIfExists(stagedPath)
}

function getDeleteContext(db: Database.Database, songId: number): DeleteContext | null {
  const song = db.prepare<[number], { file_name: string }>('SELECT file_name FROM songs WHERE id = ?').get(songId)
  if (!song) return null
  return { fileName: song.file_name }
}

function musicFilePath(paths: LibraryPaths, fileName: string): string {
  const path = join(paths.music, fileName)
  const rel = relative(paths.music, path)
  if (basename(fileName) !== fileName || isAbsolute(rel) || rel.startsWith('..')) throw new Error('歌曲文件名不合法，拒绝删除')
  return path
}

function removeIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}
