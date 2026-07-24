import { useEffect, useState } from 'react'
import type { AlbumListItem, AlbumRow, AlbumSongItem } from '../../../shared/types'
import { usePlayerStore, type PlayerTrack } from '../stores/playerStore'
import SongList from '../components/SongList'
import SongEditModal from '../components/SongEditModal'
import Cover from '../components/Cover'
import { useNavStore } from '../stores/navStore'

/*
 * Album 画廊：第一层网格展示全部专辑（圆角封面 + 左下对齐曲名/艺术家），
 * 点击进入第二层详情页，按 disc_number/track_number 严格升序展示曲目（规格 §4.3 视图 D）。
 */
export default function AlbumView(): React.JSX.Element {
  const [albums, setAlbums] = useState<AlbumListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { target, clearTarget, requestReturn } = useNavStore()

  useEffect(() => {
    window.api.albums.list().then((list) => {
      setAlbums(list)
      setLoading(false)
    })
  }, [])

  /* 外部导航进来时（如点击歌曲信息里的专辑链接），自动选中对应的专辑详情页 */
  useEffect(() => {
    if (!target || target.view !== 'album') return
    setSelectedId(target.id)
    clearTarget()
  }, [target, clearTarget])

  function handleDetailBack(): void {
    if (!requestReturn()) setSelectedId(null)
  }

  if (selectedId !== null) {
    return <AlbumDetail albumId={selectedId} onBack={handleDetailBack} />
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h1 className="text-lg font-medium">Album</h1>
        <span className="text-xs text-neutral-500">共 {albums.length} 张</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : albums.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 text-sm">暂无专辑</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {albums.map((album) => (
              <button
                key={album.id}
                onClick={() => setSelectedId(album.id)}
                className="flex flex-col gap-2 text-left group"
              >
                <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-white/5">
                  <Cover
                    cacheKey={album.id}
                    load={() => window.api.albums.cover(album.id)}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <div className="truncate text-sm group-hover:text-white">{album.title}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {album.artistNames || '未知艺术家'}
                    {album.release_date ? ` · ${album.release_date.slice(0, 4)}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface AlbumDetailProps {
  albumId: number
  onBack: () => void
}

/* 专辑二级详情页：按 disc_number/track_number 严格升序排列，最左侧展示"碟号-曲目号"代替普通序号 */
function AlbumDetail({ albumId, onBack }: AlbumDetailProps): React.JSX.Element {
  const [album, setAlbum] = useState<AlbumRow | null>(null)
  const [artists, setArtists] = useState<{ id: number; name: string; order: number }[]>([])
  const [songs, setSongs] = useState<AlbumSongItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<AlbumSongItem | null>(null)
  const { queue, currentIndex, playQueue } = usePlayerStore()

  function load(): void {
    window.api.albums.detail(albumId).then((detail) => {
      if (!detail) return
      setAlbum(detail.album)
      setArtists(detail.artists)
      setSongs(detail.songs)
      setLoading(false)
    })
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId])

  const currentSongId = currentIndex !== null ? queue[currentIndex]?.songId ?? null : null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <button onClick={onBack} className="text-neutral-400 hover:text-white text-sm">
          ← 返回
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-medium truncate">{album?.title ?? '...'}</h1>
          <div className="text-xs text-neutral-500 truncate">
            {artists.map((a) => a.name).join(' / ') || '未知艺术家'}
          </div>
        </div>
        <span className="text-xs text-neutral-500 ml-auto">共 {songs.length} 首</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : songs.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该专辑暂无曲目</div>
        ) : (
          <SongList
            songs={songs}
            currentSongId={currentSongId}
            renderLeading={(song) =>
              song.track_number != null
                ? song.disc_number != null && song.disc_number !== 1
                  ? `${song.disc_number}-${song.track_number}`
                  : String(song.track_number)
                : '--'
            }
            onPlay={(index) =>
              playQueue(
                songs.map(
                  (s): PlayerTrack => ({
                    key: `music-${s.id}`,
                    title: s.title,
                    artistNames: s.artistNames,
                    mediaUrl: window.api.songs.mediaUrl(s.file_name),
                    songId: s.id
                  })
                ),
                index
              )
            }
            onEdit={(song) => setEditingSong(song)}
          />
        )}
      </div>

      {editingSong && (
        <SongEditModal
          songId={editingSong.id}
          onClose={() => setEditingSong(null)}
          onSaved={() => {
            setEditingSong(null)
            load()
          }}
        />
      )}
    </div>
  )
}
