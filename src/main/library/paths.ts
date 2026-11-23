import { join } from 'node:path'

/* 给定音乐目录与系统数据目录（可分开存放，比如 .system 放本地 SSD，Music/Append 放外置硬盘），推导出各子目录的绝对路径 */
export function libraryPaths(musicRoot: string, systemRoot: string) {
  const system = join(systemRoot, '.system')
  const database = join(system, 'database')
  const assets = join(system, 'assets')
  return {
    musicRoot,
    systemRoot,
    append: join(musicRoot, 'Append'),
    music: join(musicRoot, 'Music'),
    system,
    database,
    dbFile: join(database, 'music.db'),
    backups: join(database, 'backups'),
    tools: join(system, 'tools'),
    ncmdump: join(system, 'tools', 'ncmdump'),
    assets,
    assetsArtistPictures: join(assets, 'artist_pictures'),
    assetsSongPictures: join(assets, 'song_pictures'),
    assetsAlbumPictures: join(assets, 'album_pictures')
  }
}

export type LibraryPaths = ReturnType<typeof libraryPaths>
