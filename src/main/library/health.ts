import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { MissingAudioFile, MissingSongCover, OrphanPictureFiles } from '../../shared/types'
import type { LibraryPaths } from './paths'

/* 只读检查已入库歌曲的物理音频是否仍存在。 */
export function findMissingAudioFiles(paths: LibraryPaths, db: Database.Database): MissingAudioFile[] {
  const songs = db.prepare<[], { id: number; title: string; file_name: string }>('SELECT id, title, file_name FROM songs ORDER BY title COLLATE NOCASE').all()
  return songs.filter((song) => !existsSync(join(paths.music, song.file_name))).map((song) => ({ songId: song.id, title: song.title, fileName: song.file_name }))
}

/* 以播放器实际使用的封面规则检查：专辑歌曲读专辑封面，其他歌曲读独立歌曲封面。 */
export function findMissingSongCovers(paths: LibraryPaths, db: Database.Database): MissingSongCover[] {
  const songs = db
    .prepare<[], { id: number; title: string; file_name: string; album_id: number | null }>(
      `SELECT s.id, s.title, s.file_name, als.album_id
       FROM songs s LEFT JOIN album_songs als ON als.song_id = s.id
       ORDER BY s.title COLLATE NOCASE`
    )
    .all()
  return songs.flatMap((song) => {
    const coverKind = song.album_id == null ? 'song' : 'album'
    const coverId = song.album_id ?? song.id
    const directory = coverKind === 'album' ? paths.assetsAlbumPictures : paths.assetsSongPictures
    return existsSync(join(directory, `${coverId}.jpg`)) ? [] : [{ songId: song.id, title: song.title, fileName: song.file_name, coverKind, coverId }]
  })
}

/* assets 中没有对应数据库记录的图片不会自动删除，只在设置页面报告给用户。 */
export function findOrphanPictureFiles(paths: LibraryPaths, db: Database.Database): OrphanPictureFiles {
  return {
    artist: findOrphanFiles(paths.assetsArtistPictures, validIds(db, 'artists')),
    song: findOrphanFiles(paths.assetsSongPictures, validIds(db, 'songs')),
    album: findOrphanFiles(paths.assetsAlbumPictures, validIds(db, 'albums'))
  }
}

function validIds(db: Database.Database, table: 'artists' | 'songs' | 'albums'): Set<number> {
  const rows = db.prepare<[], { id: number }>(`SELECT id FROM ${table}`).all()
  return new Set(rows.map((row) => row.id))
}

function findOrphanFiles(directory: string, ids: Set<number>): string[] {
  return readdirSync(directory, { withFileTypes: true })
    /* Finder 自动写入的目录元数据不是图片资源，不应进入完整性报告。 */
    .filter((entry) => entry.isFile() && entry.name.toLowerCase() !== '.ds_store')
    .map((entry) => entry.name)
    .filter((fileName) => {
      const match = /^(\d+)\.jpg$/i.exec(fileName)
      return !match || !ids.has(Number(match[1]))
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
