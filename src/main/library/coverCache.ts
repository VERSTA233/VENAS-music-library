import { writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type Database from 'better-sqlite3'
import type { LibraryPaths } from './paths'
import { getSongAlbum } from '../db/queries/albums'

const MAX_BYTES = 250 * 1024
const MAX_DIMENSION = 1000

/* 压缩封面图片至 250KB 以下；歌曲/专辑/艺术家封面共用同一套压缩策略 */
async function compressCover(imageData: Buffer): Promise<Buffer> {
  let quality = 85
  let buffer = await sharp(imageData)
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer()

  while (buffer.length > MAX_BYTES && quality > 30) {
    quality -= 10
    buffer = await sharp(imageData)
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer()
  }
  return buffer
}

function songPicturePath(paths: LibraryPaths, songId: number): string {
  return join(paths.assetsSongPictures, `${songId}.jpg`)
}

function albumPicturePath(paths: LibraryPaths, albumId: number): string {
  return join(paths.assetsAlbumPictures, `${albumId}.jpg`)
}

/*
 * 更新一首歌的封面：若歌曲已属于某张专辑，封面本质是"专辑封面"，写入 album_pictures/{albumId}.jpg，
 * 专辑内所有歌共用同一份——非手动上传场景下，专辑已有封面时直接跳过，不覆盖（避免同专辑后续歌曲的内嵌图覆盖第一首歌确立的封面）；
 * 手动上传（manual=true）视为用户明确要更换这张专辑的封面，总是覆盖。
 * 不属于任何专辑则是"歌曲独立封面"，写入 song_pictures/{songId}.jpg，总是覆盖（没有跨歌曲共享的顾虑）。
 */
export async function updateSongCover(
  paths: LibraryPaths,
  db: Database.Database,
  songId: number,
  imageData: Buffer,
  opts: { manual?: boolean } = {}
): Promise<void> {
  const album = getSongAlbum(db, songId)
  const buffer = await compressCover(imageData)

  if (album) {
    const target = albumPicturePath(paths, album.id)
    if (!opts.manual && existsSync(target)) return
    writeFileSync(target, buffer)
  } else {
    writeFileSync(songPicturePath(paths, songId), buffer)
  }
}

/*
 * 一首原本无专辑（封面存在 song_pictures）的歌加入某张专辑时调用：
 * 把它的封面迁移为该专辑的封面并改名为 albumId；若专辑已有封面则丢弃这份，不覆盖已确立的专辑封面。
 */
export function moveSongPictureToAlbum(paths: LibraryPaths, songId: number, albumId: number): void {
  const source = songPicturePath(paths, songId)
  if (!existsSync(source)) return

  const target = albumPicturePath(paths, albumId)
  if (existsSync(target)) {
    unlinkSync(source)
    return
  }
  renameSync(source, target)
}

/* 艺术家/厂牌头像：手动上传总是覆盖，没有"已存在则跳过"的共享逻辑 */
export async function writeArtistPicture(paths: LibraryPaths, artistId: number, imageData: Buffer): Promise<void> {
  const buffer = await compressCover(imageData)
  writeFileSync(join(paths.assetsArtistPictures, `${artistId}.jpg`), buffer)
}

/* 专辑封面是专辑级缓存；手动上传总是覆盖现有缓存。 */
export async function writeAlbumPicture(paths: LibraryPaths, albumId: number, imageData: Buffer): Promise<void> {
  const buffer = await compressCover(imageData)
  writeFileSync(albumPicturePath(paths, albumId), buffer)
}
