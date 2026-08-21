import type Database from 'better-sqlite3'
import type { ArtistRow, LabelListItem, AlbumRow, LabelAlbumGroup, AlbumSongItem } from '../../../shared/types'
import { withArtistNames } from './songList'
import { withAlbumLabels } from './albums'

/*
 * 厂牌本质上是 artists 表中 type='Label' 的记录，通过 album_labels 与专辑建立多对多关系，
 * 但浏览体验上厂牌与艺术家是两类不同的实体——这里单独查询、单独展示，
 * 挂在 Artist 星云页面下的"厂牌"分组里，点进去展示该厂牌旗下全部专辑对应的曲目。
 */
export function listLabels(db: Database.Database): LabelListItem[] {
  return db
    .prepare<[], LabelListItem>(
      `SELECT ar.*, COUNT(DISTINCT al.id) AS albumCount, COUNT(DISTINCT als.song_id) AS songCount
       FROM artists ar
       LEFT JOIN album_labels abl ON abl.label_id = ar.id
       LEFT JOIN albums al ON al.id = abl.album_id
       LEFT JOIN album_songs als ON als.album_id = al.id
       WHERE ar.type = 'Label'
       GROUP BY ar.id
       ORDER BY ar.name COLLATE NOCASE`
    )
    .all()
}

export function getLabelById(db: Database.Database, labelId: number): ArtistRow | null {
  const row = db.prepare<[number], ArtistRow>("SELECT * FROM artists WHERE id = ? AND type = 'Label'").get(labelId)
  return row ?? null
}

/* 厂牌详情页：按发行日期排序的专辑分组，每组内曲目按碟号/曲目号严格升序 */
export function getLabelAlbumGroups(db: Database.Database, labelId: number): LabelAlbumGroup[] {
  const baseAlbums: Omit<AlbumRow, 'labels'>[] = db
    .prepare<[number], Omit<AlbumRow, 'labels'>>(
      `SELECT al.id AS id, al.title AS title, al.release_date AS release_date, al.album_type AS album_type,
              al.total_discs AS total_discs
       FROM album_labels abl
       JOIN albums al ON al.id = abl.album_id
       WHERE abl.label_id = ?
       ORDER BY al.release_date IS NULL, al.release_date ASC, al.title COLLATE NOCASE`
    )
    .all(labelId) as Omit<AlbumRow, 'labels'>[]
  const albums = withAlbumLabels(db, baseAlbums)

  const albumIds = albums.map((album) => album.id)
  if (albumIds.length === 0) return []
  const placeholders = albumIds.map(() => '?').join(', ')
  type LabelSongRow = {
    album_id: number
    id: number
    title: string
    length: number | null
    file_name: string
    add_time: string | null
    disc_number: number | null
    track_number: number | null
  }
  const songRows: LabelSongRow[] = db.prepare<
    number[],
    LabelSongRow
  >(
      `SELECT als.album_id AS album_id, s.id AS id, s.title AS title, s.length AS length, s.file_name AS file_name, si.add_time AS add_time,
            als.disc_number AS disc_number, als.track_number AS track_number
     FROM album_songs als JOIN songs s ON s.id = als.song_id
     LEFT JOIN song_info si ON si.song_id = s.id
     WHERE als.album_id IN (${placeholders})
     ORDER BY als.album_id ASC, als.disc_number ASC, als.track_number ASC`
  ).all(...albumIds) as LabelSongRow[]
  const songsByAlbumId = new Map<number, AlbumSongItem[]>()
  const songRowsWithArtists = withArtistNames(db, songRows)
  for (const song of songRowsWithArtists) {
    const albumSongs = songsByAlbumId.get(song.album_id) ?? []
    const { album_id: _albumId, ...songItem } = song
    albumSongs.push(songItem)
    songsByAlbumId.set(song.album_id, albumSongs)
  }

  return albums.map((album): LabelAlbumGroup => ({ album, songs: songsByAlbumId.get(album.id) ?? [] }))
}
