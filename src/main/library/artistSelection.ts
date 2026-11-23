import type Database from 'better-sqlite3'
import type { ArtistSelectionInput } from '../../shared/types'
import { artistSelectionKey } from '../../shared/artistSelection'
import { createArtist, findOrCreateArtist, getArtistById } from '../db/queries/artists'

/* 在一次写入事务内共用：歌曲艺术家和专辑艺术家的同名新增项只创建一次。 */
export function createArtistSelectionResolver(db: Database.Database): (input: ArtistSelectionInput) => number {
  const newArtists = new Map<string, { id: number; type: ArtistSelectionInput['type'] }>()
  return (input) => {
    if (input.artistId != null) {
      if (!Number.isSafeInteger(input.artistId) || input.artistId <= 0 || input.createNew) throw new Error('艺术家选择无效')
      const artist = getArtistById(db, input.artistId)
      if (!artist || artist.type === 'Label') throw new Error('所选艺术家已不存在或类型不符，请重新选择')
      return artist.id
    }
    if (!input.createNew) return findOrCreateArtist(db, input.name, input.type)

    const key = artistSelectionKey(input)
    const created = newArtists.get(key)
    if (created) {
      if (created.type !== input.type) throw new Error('同一新增艺术家的类型不一致，请统一歌曲和专辑中的类型')
      return created.id
    }
    const id = createArtist(db, input.name, input.type)
    newArtists.set(key, { id, type: input.type })
    return id
  }
}

/* 入库时同名的歌曲/专辑艺术家必须指向同一记录，歌曲艺术家的选择与类型优先。 */
export function createIngestArtistSelectionResolver(db: Database.Database): {
  resolveSong: (input: ArtistSelectionInput) => number
  resolveAlbum: (input: ArtistSelectionInput) => number
} {
  const resolve = createArtistSelectionResolver(db)
  const songArtistsByName = new Map<string, number>()
  const nameKey = (name: string): string => name.trim().toLowerCase()

  return {
    resolveSong(input) {
      const id = resolve(input)
      const key = nameKey(input.name)
      if (!songArtistsByName.has(key)) songArtistsByName.set(key, id)
      return id
    },
    resolveAlbum(input) {
      return songArtistsByName.get(nameKey(input.name)) ?? resolve(input)
    }
  }
}
