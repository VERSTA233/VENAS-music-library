import type { ArtistSelectionInput } from './types'

/* 名称相同不等于同一对象：区分已有 ID、明确新增以及音频元数据的自动匹配。 */
export function artistSelectionKey(artist: Pick<ArtistSelectionInput, 'name' | 'artistId' | 'createNew'>): string {
  if (artist.artistId != null) return `id:${artist.artistId}`
  return `${artist.createNew ? 'new' : 'auto'}:${artist.name.trim().toLowerCase()}`
}
