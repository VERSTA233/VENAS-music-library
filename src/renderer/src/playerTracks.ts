import type { SongListItem } from '../../shared/types'
import type { PlayerTrack } from './stores/playerStore'

/* 已入库歌曲在各列表中的播放队列表示完全一致，集中转换避免遗漏字段。 */
export function toMusicPlayerTrack(song: SongListItem): PlayerTrack {
  return {
    key: `music-${song.id}`,
    title: song.title,
    artistNames: song.artistNames,
    mediaUrl: window.api.songs.mediaUrl(song.file_name),
    songId: song.id,
    appendEntry: null
  }
}
