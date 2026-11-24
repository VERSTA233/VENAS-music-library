import type { AlbumListSort, ArtistListSort, ListSortPreferences, SongListSort, SortDirection } from './types'

export type SortValue = { song: SongListSort; artist: ArtistListSort; album: AlbumListSort }
export const listSortConfigs: { [K in keyof SortValue]: { label: string; options: { value: SortValue[K]; label: string }[] } } = {
  song: { label: '歌曲', options: [
    { value: 'library', label: '音乐库顺序' }, { value: 'title', label: '首字母' },
    { value: 'addedAt', label: '添加时间' }, { value: 'lastHeard', label: '最近聆听时间' }, { value: 'score', label: '评分' }
  ] },
  artist: { label: '艺术家', options: [{ value: 'library', label: '音乐库顺序' }, { value: 'name', label: '首字母' }, { value: 'count', label: '歌曲数量' }] },
  album: { label: '专辑', options: [{ value: 'library', label: '音乐库顺序' }, { value: 'title', label: '首字母' }, { value: 'count', label: '歌曲数量' }] }
}

export const defaultListSortPreferences: ListSortPreferences = {
  music: { sort: 'library', direction: 'desc' },
  artists: { sort: 'name', direction: 'asc' },
  albums: { sort: 'title', direction: 'asc' },
  artistSongs: { sort: 'library', direction: 'desc' },
  labelSongs: { sort: 'library', direction: 'desc' }
}

export function defaultSortDirection(sort: string): SortDirection {
  return sort === 'title' || sort === 'name' ? 'asc' : 'desc'
}

export function isListSortPreference(key: string, value: unknown): boolean {
  if (!Object.hasOwn(defaultListSortPreferences, key) || !value || typeof value !== 'object') return false
  const { sort, direction } = value as { sort?: unknown; direction?: unknown }
  const kind = key === 'artists' ? 'artist' : key === 'albums' ? 'album' : 'song'
  return (direction === 'asc' || direction === 'desc') && listSortConfigs[kind].options.some(option => option.value === sort)
}

/* 旧配置没有此字段，或选项已失效时，只恢复对应页面的默认排序。 */
export function normalizeListSortPreferences(value: unknown): ListSortPreferences {
  const result = { ...defaultListSortPreferences }
  if (!value || typeof value !== 'object') return result
  for (const key of Object.keys(result) as (keyof ListSortPreferences)[]) {
    const preference = (value as Record<string, unknown>)[key]
    if (isListSortPreference(key, preference)) Object.assign(result, { [key]: preference })
  }
  return result
}
