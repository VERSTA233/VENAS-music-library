import type { SongDetail } from '../../shared/types'

/* 普通字段空值保留原值；ALBUM / ALBUMARTIST 始终生成，空字符串明确要求删除旧字段。 */
export function buildFlacTagValues(song: SongDetail): Record<string, string> {
  const tags: Record<string, string> = {}
  function add(name: string, value: string | number | null | undefined): void {
    if (value != null && String(value).trim() !== '') tags[name] = String(value)
  }
  function tagNames(type: string): string {
    return song.tags.filter((tag) => tag.tag_type?.toLowerCase() === type).sort((a, b) => a.id - b.id)
      .map((tag) => tag.name).join('/')
  }

  add('TITLE', song.title)
  add('ARTIST', [...song.artists].sort((a, b) => a.order - b.order || a.id - b.id || (a.role ?? '').localeCompare(b.role ?? '')).map((artist) => artist.name).join('/'))
  tags.ALBUM = song.album?.title ?? ''
  add('DATE', song.album?.release_date)
  add('TRACKNUMBER', song.album?.track_number)
  add('DISCNUMBER', song.album?.disc_number)
  add('DISCTOTAL', song.album?.total_discs)
  add('GENRE', tagNames('genre'))
  add('MOOD', tagNames('mood'))
  tags.ALBUMARTIST = song.album ? [...song.album.artists].sort((a, b) => a.order - b.order || a.id - b.id).map((artist) => artist.name).join('/') : ''
  add('LABEL', song.album && [...song.album.labels].sort((a, b) => a.order - b.order || a.id - b.id).map((label) => label.name).join('/'))
  add('WORK', tagNames('work'))
  add('GROUPING', tagNames('theme'))
  add('LYRICS', song.lyric)
  add('COMMENT', song.comment)
  add('RELEASETYPE', song.album?.album_type)
  return tags
}
