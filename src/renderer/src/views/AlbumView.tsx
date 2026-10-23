import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { AlbumListItem, AlbumListSort, AlbumRow, AlbumSongItem, SortDirection } from '../../../shared/types'
import { usePlayerStore } from '../stores/playerStore'
import { toMusicPlayerTrack } from '../playerTracks'
import SongList from '../components/SongList'
import SongListToolbarActions from '../components/SongListToolbarActions'
import RandomPlayButton from '../components/RandomPlayButton'
import BrowseToolbarActions from '../components/BrowseToolbarActions'
import AlbumSortControl from '../components/AlbumSortControl'
import SongEditModal from '../components/SongEditModal'
import Cover from '../components/Cover'
import { useNavStore } from '../stores/navStore'
import { filterAlbums, filterSongs } from '../songSearch'
import AlbumEditModal from '../components/AlbumEditModal'

/*
 * Album 画廊：第一层网格展示全部专辑（圆角封面 + 左下对齐曲名/艺术家），
 * 点击进入第二层详情页，按 disc_number/track_number 严格升序展示曲目（规格 §4.3 视图 D）。
 */
export default function AlbumView(): React.JSX.Element {
  const [albums, setAlbums] = useState<AlbumListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sort, setSort] = useState<AlbumListSort>('title')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [query, setQuery] = useState('')
  const { target, clearTarget, navigate, openRoot, requestReturn } = useNavStore()

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
    if (requestReturn()) return
    setSelectedId(null)
    openRoot('album')
  }

  function handleDetailDeleted(albumId: number): void {
    setAlbums((current) => current.filter((album) => album.id !== albumId))
    setSelectedId(null)
    if (requestReturn()) return
    openRoot('album')
  }

  const filteredAlbums = useMemo(() => filterAlbums(albums, query), [albums, query])
  const visibleAlbums = useMemo(() => {
    const multiplier = sortDirection === 'asc' ? 1 : -1
    if (sort === 'library') return [...filteredAlbums].sort((a, b) => multiplier * (a.id - b.id))
    if (sort === 'count') {
      return [...filteredAlbums].sort((a, b) => multiplier * (a.songCount - b.songCount || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })))
    }
    return [...filteredAlbums].sort((a, b) => multiplier * (a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id - b.id))
  }, [filteredAlbums, sort, sortDirection])

  function handleSortChange(nextSort: AlbumListSort): void {
    setSort(nextSort)
    setSortDirection(nextSort === 'title' ? 'asc' : 'desc')
  }

  if (selectedId !== null) {
    return <AlbumDetail albumId={selectedId} onBack={handleDetailBack} onDeleted={() => handleDetailDeleted(selectedId)} />
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 justify-between border-b border-white/[0.08]">
        <div><h1 className="text-xl font-semibold leading-tight">Album</h1></div>
        <BrowseToolbarActions
          query={query}
          onQueryChange={setQuery}
          placeholder="搜索专辑、艺术家或厂牌"
          searchLabel="搜索专辑、艺术家或厂牌"
          sortControl={<AlbumSortControl value={sort} onChange={handleSortChange} direction={sortDirection} onDirectionChange={setSortDirection} />}
          count={filteredAlbums.length}
          countUnit="张"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : visibleAlbums.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 text-sm">{query ? '没有匹配的专辑' : '暂无专辑'}</div>
        ) : (
          <div className="grid gap-x-5 gap-y-7" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {visibleAlbums.map((album) => (
              <button
                key={album.id}
                onClick={() => navigate({ view: 'album', id: album.id })}
                className="group flex flex-col gap-2.5 text-left transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/[0.05] shadow-lg shadow-black/20 ring-1 ring-white/[0.06] transition duration-200 group-hover:ring-white/[0.18]">
                  <Cover
                    cacheKey={album.id}
                    load={() => window.api.albums.cover(album.id)}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <div className="truncate text-sm font-medium text-neutral-100 group-hover:text-white">{album.title}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {album.artistNames || album.labels.map((label) => label.name).join(' / ') || '未知艺术家'}
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
  onDeleted: () => void
}

/* 专辑二级详情页：顶栏集中展示专辑封面与身份信息，曲目按数据库的碟号/曲目号顺序排列。 */
function AlbumDetail({ albumId, onBack, onDeleted }: AlbumDetailProps): React.JSX.Element {
  const [album, setAlbum] = useState<AlbumRow | null>(null)
  const [artists, setArtists] = useState<{ id: number; name: string; order: number }[]>([])
  const [songs, setSongs] = useState<AlbumSongItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<AlbumSongItem | null>(null)
  const [editingAlbum, setEditingAlbum] = useState(false)
  const [pictureVersion, setPictureVersion] = useState(0)
  const [query, setQuery] = useState('')
  const { queue, currentIndex, playQueue, playRandomQueue } = usePlayerStore()

  function load(): void {
    window.api.albums.detail(albumId).then((detail) => {
      if (!detail) {
        onDeleted()
        return
      }
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
  const filteredSongs = useMemo(
    () => filterSongs(songs, query, [album?.title ?? '', ...(album?.labels.map((label) => label.name) ?? [])]),
    [album?.labels, album?.title, query, songs]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 gap-3 border-b border-white/[0.08]">
        <button onClick={onBack} className="library-icon-button" title="返回" aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/5">
          <Cover
            cacheKey={`${albumId}-${pictureVersion}`}
            load={() => window.api.albums.cover(albumId)}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium leading-tight">{album?.title ?? '...'}</h1>
          <div className="truncate text-xs text-neutral-500">
            {artists.map((a) => a.name).join(' / ') || album?.labels.map((label) => label.name).join(' / ') || '未知艺术家'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditingAlbum(true)}
          disabled={!album || loading}
          className="library-icon-button disabled:cursor-not-allowed disabled:opacity-30"
          title="编辑专辑"
          aria-label="编辑专辑"
        >
          <Pencil size={16} />
        </button>
        <SongListToolbarActions
          query={query}
          onQueryChange={setQuery}
          sort="library"
          onSortChange={() => undefined}
          count={filteredSongs.length}
          searchLabel="搜索当前专辑"
          showSort={false}
          children={<RandomPlayButton onClick={() => playRandomQueue(filteredSongs.map(toMusicPlayerTrack))} disabled={filteredSongs.length === 0} />}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : filteredSongs.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该专辑暂无曲目</div>
        ) : (
          <SongList
            songs={filteredSongs}
            currentSongId={currentSongId}
            showCover={false}
            renderLeading={(song) =>
              song.track_number != null
                ? String(song.track_number)
                : '--'
            }
            onPlay={(index) =>
              playQueue(
                filteredSongs.map(toMusicPlayerTrack),
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

      {editingAlbum && album && (
        <AlbumEditModal
          album={album}
          artists={artists}
          onClose={() => setEditingAlbum(false)}
          onSaved={() => {
            setEditingAlbum(false)
            load()
          }}
          onCoverChanged={() => setPictureVersion((version) => version + 1)}
        />
      )}
    </div>
  )
}
