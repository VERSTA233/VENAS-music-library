import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import type {
  ArtistListItem,
  ArtistAliasOf,
  ArtistRow,
  SongListItem,
  LabelListItem,
  LabelAlbumGroup,
  AlbumSongItem
} from '../../../shared/types'
import { useListPlayback } from '../hooks/useListPlayback'
import { toMusicPlayerTrack } from '../playerTracks'
import SongList from '../components/SongList'
import SongListToolbarActions from '../components/SongListToolbarActions'
import RandomPlayButton from '../components/RandomPlayButton'
import BrowseToolbarActions from '../components/BrowseToolbarActions'
import ListSortControl from '../components/ListSortControl'
import LibraryContent from '../components/LibraryContent'
import SongEditModal from '../components/SongEditModal'
import ArtistEditModal from '../components/ArtistEditModal'
import Cover from '../components/Cover'
import { useNavStore } from '../stores/navStore'
import { useListSort } from '../stores/listSortStore'
import { filterArtists, filterSongs, sortSongs } from '../songSearch'

type GridItem = ArtistListItem | LabelListItem

interface Selected {
  id: number
  isLabel: boolean
}

function artistDescriptor(artist: ArtistRow | null): string | null {
  if (!artist) return null
  return [artist.type, artist.country].filter((value): value is string => Boolean(value)).join(' · ') || null
}

/*
 * Artist 星云：第一层网格合并展示全部艺术家与全部厂牌（厂牌本质也是 artists 记录，type='Label'），
 * 按名称统一排序混排；点击普通艺术家进入其关联曲目详情页，点击厂牌进入按专辑分组的详情页
 * （展示该厂牌旗下所有专辑对应的全部曲目，规格 §4.3 视图 C 的扩展）。
 */
export default function ArtistView(): React.JSX.Element {
  const [items, setItems] = useState<GridItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [memberHistory, setMemberHistory] = useState<Selected[]>([])
  const { sort, sortDirection, setSort, setSortDirection } = useListSort('artists')
  const [query, setQuery] = useState('')
  const { target, clearTarget, navigate, openRoot, requestReturn } = useNavStore()

  useEffect(() => {
    Promise.all([window.api.artists.list(), window.api.artists.listLabels()]).then(([artists, labels]) => {
      const merged = [...artists, ...labels]
      setItems(merged)
      setLoading(false)
    })
  }, [])

  /* 外部导航进来时（如点击歌曲信息里的艺术家/厂牌链接），自动选中对应的艺术家/厂牌详情页 */
  useEffect(() => {
    if (!target || target.view !== 'artist') return
    setMemberHistory([])
    setSelected({ id: target.id, isLabel: target.isLabel })
    clearTarget()
  }, [target, clearTarget])

  /* 详情页返回：若是从 Music 列表跳转过来的，跨视图返回原位置（含滚动），否则退回本视图的第一层网格 */
  function handleDetailBack(): void {
    if (memberHistory.length) {
      const previous = memberHistory[memberHistory.length - 1]
      setMemberHistory((history) => history.slice(0, -1))
      setSelected(previous)
      void window.api.navigation.saveSession({ view: 'artist', target: { view: 'artist', ...previous } }).catch(() => undefined)
      return
    }
    if (requestReturn()) return
    setSelected(null)
    openRoot('artist')
  }

  function handleDetailDeleted(id: number): void {
    setItems((current) => current.filter((item) => item.id !== id))
    if (memberHistory.length) {
      handleDetailBack()
      return
    }
    setSelected(null)
    if (requestReturn()) return
    openRoot('artist')
  }

  function handleMemberNavigate(member: ArtistRow): void {
    if (!selected || selected.id === member.id) return
    const next = { id: member.id, isLabel: member.type === 'Label' }
    setMemberHistory((history) => [...history, selected])
    setSelected(next)
    void window.api.navigation.saveSession({ view: 'artist', target: { view: 'artist', ...next } }).catch(() => undefined)
  }

  const filteredItems = useMemo(() => filterArtists(items, query), [items, query])
  const visibleItems = useMemo(() => {
    const multiplier = sortDirection === 'asc' ? 1 : -1
    /* 与 Music 页的默认库顺序一致：较晚写入数据库的记录优先。 */
    if (sort === 'library') return [...filteredItems].sort((a, b) => multiplier * (a.id - b.id))
    if (sort === 'count') {
      return [...filteredItems].sort((a, b) => multiplier * (a.songCount - b.songCount || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
    }
    return [...filteredItems].sort((a, b) => multiplier * (a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id))
  }, [filteredItems, sort, sortDirection])

  if (selected !== null) {
    return selected.isLabel ? (
      <LabelDetail key={`label:${selected.id}`} labelId={selected.id} onBack={handleDetailBack} onDeleted={() => handleDetailDeleted(selected.id)} onMemberNavigate={handleMemberNavigate} />
    ) : (
      <ArtistDetail key={`artist:${selected.id}`} artistId={selected.id} onBack={handleDetailBack} onDeleted={() => handleDetailDeleted(selected.id)} onMemberNavigate={handleMemberNavigate} />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 justify-between border-b border-white/[0.08]">
        <div><h1 className="text-xl font-semibold leading-tight">Artist</h1></div>
        <BrowseToolbarActions
          query={query}
          onQueryChange={setQuery}
          placeholder="搜索艺术家或厂牌"
          searchLabel="搜索艺术家或厂牌"
          sortControl={<ListSortControl kind="artist" value={sort} onChange={setSort} direction={sortDirection} onDirectionChange={setSortDirection} />}
          count={filteredItems.length}
          countUnit="位"
        />
      </div>

      <LibraryContent loading={loading} layout="artists" className="p-6">
        {visibleItems.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 text-sm">{query ? '没有匹配的艺术家或厂牌' : '暂无艺术家'}</div>
        ) : (
          <div className="grid gap-x-5 gap-y-7" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))' }}>
            {visibleItems.map((item) => {
              const isLabel = item.type === 'Label'
              return (
                <button
                  key={item.id}
                  onClick={() => navigate({ view: 'artist', id: item.id, isLabel })}
                  className="library-card group flex flex-col items-center gap-2.5 text-left"
                >
                  <div className="aspect-square w-full overflow-hidden rounded-full bg-white/[0.05] shadow-lg shadow-black/20 ring-1 ring-white/[0.06] transition duration-200 group-hover:ring-white/[0.18]">
                    <Cover
                      cacheKey={item.id}
                      thumbnailKey={`artist:${item.id}`}
                      resource={{ kind: 'artist', id: item.id }}
                      load={() => window.api.artists.picture(item.id)}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="w-full text-center">
                    <div className="truncate text-sm font-medium text-neutral-100 group-hover:text-white">{item.name}</div>
                    <div className="truncate text-xs text-neutral-500">{item.songCount} 首</div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </LibraryContent>
    </div>
  )
}

interface ArtistDetailProps {
  artistId: number
  onBack: () => void
  onDeleted: () => void
  onMemberNavigate: (member: ArtistRow) => void
}

/* 艺术家二级详情页：聚合展示该艺术家在 song_artists 表中关联的全部曲目 */
function ArtistDetail({ artistId, onBack, onDeleted, onMemberNavigate }: ArtistDetailProps): React.JSX.Element {
  const [artist, setArtist] = useState<ArtistRow | null>(null)
  const [aliasOf, setAliasOf] = useState<ArtistAliasOf | null>(null)
  const [members, setMembers] = useState<ArtistRow[]>([])
  const [songs, setSongs] = useState<SongListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<SongListItem | null>(null)
  const [editingArtist, setEditingArtist] = useState(false)
  const { sort, sortDirection, setSort, setSortDirection } = useListSort('artistSongs')
  const [query, setQuery] = useState('')
  const { currentSongId, playQueue, playRandomQueue } = useListPlayback()

  useEffect(() => {
    setLoading(true)
    window.api.artists.detail(artistId).then((detail) => {
      if (!detail) {
        onDeleted()
        return
      }
      setArtist(detail.artist)
      setMembers(detail.members)
      setAliasOf(detail.aliasOf)
      setSongs(detail.songs)
      setLoading(false)
    })
  }, [artistId])

  const filteredSongs = useMemo(
    () => filterSongs(songs, query, [artist?.name ?? '']),
    [artist?.name, query, songs]
  )
  const sortedSongs = useMemo(() => sortSongs(filteredSongs, sort, sortDirection), [filteredSongs, sort, sortDirection])

  function refresh(): void {
    window.api.artists.detail(artistId).then((detail) => {
      if (!detail) {
        onDeleted()
        return
      }
      setArtist(detail.artist)
      setMembers(detail.members)
      setAliasOf(detail.aliasOf)
      setSongs(detail.songs)
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 gap-3 border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="library-icon-button"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
          <Cover
            cacheKey={artistId}
            resource={{ kind: 'artist', id: artistId }}
            load={() => window.api.artists.picture(artistId)}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium leading-tight">{artist?.name ?? '...'}</h1>
          {(aliasOf ? `a.k.a. ${aliasOf.name}` : artistDescriptor(artist)) && (
            <p className="truncate text-xs text-neutral-500">{aliasOf ? `a.k.a. ${aliasOf.name}` : artistDescriptor(artist)}</p>
          )}
        </div>
        <button
          onClick={() => setEditingArtist(true)}
          className="library-icon-button"
          title="编辑艺术家"
          aria-label="编辑艺术家"
        >
          <Pencil size={16} />
        </button>
        <SongListToolbarActions
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          direction={sortDirection}
          onDirectionChange={setSortDirection}
          count={filteredSongs.length}
          searchLabel="搜索当前艺术家"
          children={<RandomPlayButton onClick={() => playRandomQueue(sortedSongs.map(toMusicPlayerTrack))} disabled={sortedSongs.length === 0} />}
        />
      </div>

      <LibraryContent loading={loading} className="py-2">
        {!loading && <MemberLinks members={members} onNavigate={onMemberNavigate} />}
        {filteredSongs.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该艺术家暂无关联曲目</div>
        ) : (
          <SongList
            songs={sortedSongs}
            currentSongId={currentSongId}
            onPlay={(index) =>
              playQueue(
                sortedSongs.map(toMusicPlayerTrack),
                index
              )
            }
            onEdit={(song) => setEditingSong(song)}
          />
        )}
      </LibraryContent>

      {editingSong && (
        <SongEditModal
          songId={editingSong.id}
          onClose={() => setEditingSong(null)}
          onSaved={() => {
            setEditingSong(null)
            refresh()
          }}
        />
      )}

      {editingArtist && artist && (
        <ArtistEditModal
          artist={artist}
          members={members}
          aliasOf={aliasOf}
          onClose={() => setEditingArtist(false)}
          onSaved={() => {
            setEditingArtist(false)
            refresh()
          }}
          onDeleted={onDeleted}
          onNavigateMember={onMemberNavigate}
        />
      )}
    </div>
  )
}

interface LabelDetailProps {
  labelId: number
  onBack: () => void
  onDeleted: () => void
  onMemberNavigate: (member: ArtistRow) => void
}

/*
 * 厂牌二级详情页：按专辑分组展示旗下全部曲目（组内按碟号/曲目号排序），
 * 双击任一曲目将播放队列重置为该厂牌下全部专辑的全部曲目（跨专辑按分组顺序拼接）。
 */
function LabelDetail({ labelId, onBack, onDeleted, onMemberNavigate }: LabelDetailProps): React.JSX.Element {
  const [label, setLabel] = useState<ArtistRow | null>(null)
  const [members, setMembers] = useState<ArtistRow[]>([])
  const [groups, setGroups] = useState<LabelAlbumGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<AlbumSongItem | null>(null)
  const [editingLabel, setEditingLabel] = useState(false)
  const { sort, sortDirection, setSort, setSortDirection } = useListSort('labelSongs')
  const [query, setQuery] = useState('')
  const { currentSongId, playQueue, playRandomQueue } = useListPlayback()

  function load(): void {
    window.api.artists.labelDetail(labelId).then((detail) => {
      if (!detail) {
        onDeleted()
        return
      }
      setLabel(detail.label)
      setMembers(detail.members)
      setGroups(detail.groups)
      setLoading(false)
    })
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelId])

  const filteredGroups = useMemo(
    () => groups
      .map((group) => ({
        ...group,
        songs: filterSongs(group.songs, query, [label?.name ?? '', group.album.title])
      }))
      .filter((group) => group.songs.length > 0),
    [groups, label?.name, query]
  )
  const sortedGroups = useMemo(
    () => filteredGroups.map((group) => ({ ...group, songs: sortSongs(group.songs, sort, sortDirection) })),
    [filteredGroups, sort, sortDirection]
  )
  const allSongs = sortedGroups.flatMap((g) => g.songs)

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 gap-3 border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="library-icon-button"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
          <Cover
            cacheKey={labelId}
            resource={{ kind: 'artist', id: labelId }}
            load={() => window.api.artists.picture(labelId)}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium leading-tight">{label?.name ?? '...'}</h1>
          {artistDescriptor(label) && <p className="truncate text-xs text-neutral-500">{artistDescriptor(label)}</p>}
        </div>
        <button
          onClick={() => setEditingLabel(true)}
          className="library-icon-button"
          title="编辑厂牌"
          aria-label="编辑厂牌"
        >
          <Pencil size={16} />
        </button>
        <SongListToolbarActions
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          direction={sortDirection}
          onDirectionChange={setSortDirection}
          count={allSongs.length}
          searchLabel="搜索当前厂牌"
          children={<RandomPlayButton onClick={() => playRandomQueue(allSongs.map(toMusicPlayerTrack))} disabled={allSongs.length === 0} />}
        />
      </div>

      <LibraryContent loading={loading} className="py-2">
        {!loading && <MemberLinks members={members} onNavigate={onMemberNavigate} />}
        {sortedGroups.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该厂牌暂无关联专辑</div>
        ) : (
          sortedGroups.map((group, gi) => {
            const offset = sortedGroups.slice(0, gi).reduce((n, g) => n + g.songs.length, 0)
            return (
              <div key={group.album.id} className="mb-4">
                <div className="library-subtoolbar sticky top-0 z-[1] px-4 py-1.5 text-xs text-neutral-400">
                  {group.album.title}
                  {group.album.release_date ? ` · ${group.album.release_date.slice(0, 4)}` : ''}
                </div>
                <SongList
                  songs={group.songs}
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
                      allSongs.map(toMusicPlayerTrack),
                      offset + index
                    )
                  }
                  onEdit={(song) => setEditingSong(song)}
                />
              </div>
            )
          })
        )}
      </LibraryContent>

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

      {editingLabel && label && (
        <ArtistEditModal
          artist={label}
          members={members}
          allowTypeEdit={false}
          allowManagement={false}
          onClose={() => setEditingLabel(false)}
          onSaved={() => {
            setEditingLabel(false)
            load()
          }}
          onDeleted={onDeleted}
          onNavigateMember={onMemberNavigate}
        />
      )}
    </div>
  )
}

function MemberLinks({ members, onNavigate }: { members: ArtistRow[]; onNavigate: (member: ArtistRow) => void }): React.JSX.Element | null {
  if (!members.length) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/[0.06] px-4 pb-2 text-sm">
      <span className="mr-1 text-xs text-neutral-500">成员</span>
      {members.map((member) => (
        <button key={member.id} type="button" onClick={() => onNavigate(member)}
          className="max-w-full truncate rounded-lg px-2 py-1.5 text-neutral-300 transition hover:bg-white/[0.05] hover:text-white"
          title={`查看艺术家 ${member.name}`}>{member.name}</button>
      ))}
    </div>
  )
}
