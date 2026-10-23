import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import type Database from 'better-sqlite3'
import type {
  AlbumWithoutSongs,
  ArtistWithoutSongs,
  DuplicateArtistNameGroup,
  MissingAudioFile,
  MissingSongCover,
  OrphanPictureFiles
} from '../../shared/types'
import type { LibraryPaths } from './paths'
import { updateSongCover } from './coverCache'

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

/*
 * 修复缺失的歌曲/专辑封面缓存：只读取音频内嵌图片并写入缓存，不修改音频或数据库。
 * 同一张专辑可能有多首歌曲，逐首尝试可以在第一首没有封面时继续从其他歌曲恢复。
 */
export async function repairMissingSongCovers(paths: LibraryPaths, db: Database.Database): Promise<MissingSongCover[]> {
  const missing = findMissingSongCovers(paths, db)
  const repaired = new Set<string>()
  for (const item of missing) {
    const cacheKey = `${item.coverKind}:${item.coverId}`
    if (repaired.has(cacheKey)) continue
    try {
      const metadata = await parseFile(join(paths.music, item.fileName))
      const picture = metadata.common.picture?.[0]
      if (!picture) continue
      await updateSongCover(paths, db, item.songId, Buffer.from(picture.data))
      repaired.add(cacheKey)
    } catch {
      /* 单个文件损坏、缺失或封面格式无法处理时，保留在最终检查结果中。 */
    }
  }
  return findMissingSongCovers(paths, db)
}

/* assets 中没有对应数据库记录的图片不会自动删除，只在设置页面报告给用户。 */
export function findOrphanPictureFiles(paths: LibraryPaths, db: Database.Database): OrphanPictureFiles {
  return {
    artist: findOrphanFiles(paths.assetsArtistPictures, validIds(db, 'artists')),
    song: findOrphanFiles(paths.assetsSongPictures, validIds(db, 'songs')),
    album: findOrphanFiles(paths.assetsAlbumPictures, validIds(db, 'albums'))
  }
}

/* 数据库结构检查只报告问题，不在检查过程中修改任何记录。 */
export function findAlbumsWithoutSongs(db: Database.Database): AlbumWithoutSongs[] {
  return db
    .prepare<[], AlbumWithoutSongs>(
      `SELECT al.id AS albumId, al.title AS title
       FROM albums al
       WHERE NOT EXISTS (SELECT 1 FROM album_songs als WHERE als.album_id = al.id)
       ORDER BY al.title COLLATE NOCASE, al.id`
    )
    .all()
}

/*
 * 普通艺术家的歌曲包括 song_artists，以及作为专辑艺术家关联到的专辑曲目；
 * 主艺名还汇总其别名的关联，厂牌包括旗下专辑的曲目。
 * 不依赖 type 排除其他关联，避免异常类型数据导致有歌曲的对象被误报为空。
 */
export function findArtistsWithoutSongs(db: Database.Database): ArtistWithoutSongs[] {
  return db
    .prepare<[], ArtistWithoutSongs>(
      `WITH music_artists AS (
         SELECT artist_id FROM song_artists
         UNION
         SELECT aa.artist_id FROM album_artists aa
         JOIN album_songs als ON als.album_id = aa.album_id
         UNION
         SELECT abl.label_id FROM album_labels abl
         JOIN album_songs als ON als.album_id = abl.album_id
       )
       SELECT ar.id AS artistId, ar.name AS name, ar.type AS type
       FROM artists ar
       WHERE NOT EXISTS (
         SELECT 1 FROM music_artists ma
         WHERE ma.artist_id = ar.id OR ma.artist_id IN (
           SELECT alias_artist_id FROM artist_aliases WHERE canonical_artist_id = ar.id
         )
       )
       ORDER BY ar.name COLLATE NOCASE, ar.id`
    )
    .all()
}

/* 名称按应用现有输入规则 trim，并按大小写不敏感方式分组；同类和跨类型重名都会报告。 */
export function findDuplicateArtistNames(db: Database.Database): DuplicateArtistNameGroup[] {
  const artists = db
    .prepare<[], { artistId: number; name: string; type: string | null }>(
      'SELECT id AS artistId, name, type FROM artists ORDER BY trim(name) COLLATE NOCASE, id'
    )
    .all()
  const groups = new Map<string, DuplicateArtistNameGroup>()
  for (const artist of artists) {
    const trimmedName = artist.name.trim()
    const key = trimmedName.toLocaleLowerCase()
    const group: DuplicateArtistNameGroup = groups.get(key) ?? { name: trimmedName, records: [] }
    group.records.push(artist)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.records.length > 1)
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
