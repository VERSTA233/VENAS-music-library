import type { AlbumListItem, ArtistListItem, LabelListItem, SongListItem } from '../../shared/types'
import { buildSearchTerms } from '../../shared/searchTerms'

/* Artist 第一层网格按名称搜索，支持罗马字、平假名和片假名互相匹配。 */
export function filterArtists<T extends ArtistListItem | LabelListItem>(items: T[], query: string): T[] {
  const terms = buildSearchTerms(query)
  if (terms.length === 0) return items
  return items.filter((item) => {
    const name = item.name.toLocaleLowerCase()
    return terms.some((term) => name.includes(term))
  })
}

/* Album 第一层网格搜索专辑名、专辑艺术家与厂牌，假名规则与 Music/Artist 保持一致。 */
export function filterAlbums(albums: AlbumListItem[], query: string): AlbumListItem[] {
  const terms = buildSearchTerms(query)
  if (terms.length === 0) return albums
  return albums.filter((album) => {
    const fields = [album.title, album.artistNames, ...album.labels.map((label) => label.name)]
      .filter((field): field is string => Boolean(field))
      .map((field) => field.toLocaleLowerCase())
    return terms.some((term) => fields.some((field) => field.includes(term)))
  })
}

/* 分类详情页已加载本分类全部曲目，因此在本地按和音乐库一致的字段及假名规则筛选。 */
export function filterSongs<T extends SongListItem>(songs: T[], query: string, contextTerms: string[] = []): T[] {
  const terms = buildSearchTerms(query)
  if (terms.length === 0) return songs

  return songs.filter((song) => {
    const fields = [song.title, song.artistNames, ...contextTerms]
      .filter((field): field is string => Boolean(field))
      .map((field) => field.toLocaleLowerCase())

    return terms.some((term) => fields.some((field) => field.includes(term)))
  })
}
