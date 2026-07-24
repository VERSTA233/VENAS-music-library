import { useEffect, useRef, useState } from 'react'
import type {
  ArtistListItem,
  ArtistRow,
  SongListItem,
  LabelListItem,
  LabelAlbumGroup,
  AlbumSongItem
} from '../../../shared/types'
import { usePlayerStore, type PlayerTrack } from '../stores/playerStore'
import SongList from '../components/SongList'
import SongEditModal from '../components/SongEditModal'
import Cover from '../components/Cover'
import { useNavStore } from '../stores/navStore'

type GridItem = ArtistListItem | LabelListItem

interface Selected {
  id: number
  isLabel: boolean
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
  const { target, clearTarget, requestReturn } = useNavStore()

  useEffect(() => {
    Promise.all([window.api.artists.list(), window.api.artists.listLabels()]).then(([artists, labels]) => {
      const merged = [...artists, ...labels].sort((a, b) => a.name.localeCompare(b.name))
      setItems(merged)
      setLoading(false)
    })
  }, [])

  /* 外部导航进来时（如点击歌曲信息里的艺术家/厂牌链接），自动选中对应的艺术家/厂牌详情页 */
  useEffect(() => {
    if (!target || target.view !== 'artist') return
    setSelected({ id: target.id, isLabel: target.isLabel })
    clearTarget()
  }, [target, clearTarget])

  /* 详情页返回：若是从 Music 列表跳转过来的，跨视图返回原位置（含滚动），否则退回本视图的第一层网格 */
  function handleDetailBack(): void {
    if (!requestReturn()) setSelected(null)
  }

  if (selected !== null) {
    return selected.isLabel ? (
      <LabelDetail labelId={selected.id} onBack={handleDetailBack} />
    ) : (
      <ArtistDetail artistId={selected.id} onBack={handleDetailBack} />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/10 backdrop-blur-xl bg-neutral-900/70">
        <h1 className="text-lg font-medium">Artist</h1>
        <span className="text-xs text-neutral-500">共 {items.length} 个</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 text-sm">暂无艺术家</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {items.map((item) => {
              const isLabel = item.type === 'Label'
              return (
                <button
                  key={item.id}
                  onClick={() => setSelected({ id: item.id, isLabel })}
                  className="flex flex-col items-center gap-2 text-left group transition-transform duration-150 ease-out active:scale-95"
                >
                  <div className="w-full aspect-square rounded-full overflow-hidden bg-white/5">
                    <Cover
                      cacheKey={item.id}
                      load={() => window.api.artists.picture(item.id)}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="w-full text-center">
                    <div className="truncate text-sm group-hover:text-white">{item.name}</div>
                    <div className="truncate text-xs text-neutral-500">{item.songCount} 首</div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface ArtistDetailProps {
  artistId: number
  onBack: () => void
}

/* 艺术家二级详情页：聚合展示该艺术家在 song_artists 表中关联的全部曲目 */
function ArtistDetail({ artistId, onBack }: ArtistDetailProps): React.JSX.Element {
  const [artist, setArtist] = useState<ArtistRow | null>(null)
  const [songs, setSongs] = useState<SongListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<SongListItem | null>(null)
  const [pictureVersion, setPictureVersion] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { queue, currentIndex, playQueue } = usePlayerStore()

  async function handleUploadPicture(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await window.api.artists.setManualPicture(artistId, bytes)
      setPictureVersion((v) => v + 1)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    setLoading(true)
    window.api.artists.detail(artistId).then((detail) => {
      if (!detail) return
      setArtist(detail.artist)
      setSongs(detail.songs)
      setLoading(false)
    })
  }, [artistId])

  const currentSongId = currentIndex !== null ? queue[currentIndex]?.songId ?? null : null

  function refresh(): void {
    window.api.artists.detail(artistId).then((detail) => {
      if (!detail) return
      setArtist(detail.artist)
      setSongs(detail.songs)
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-white/10 backdrop-blur-xl bg-neutral-900/70">
        <button
          onClick={onBack}
          className="text-neutral-400 hover:text-white text-sm transition-transform duration-150 ease-out active:scale-95"
        >
          ← 返回
        </button>
        <div className="w-8 h-8 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
          <Cover
            cacheKey={`${artistId}-${pictureVersion}`}
            load={() => window.api.artists.picture(artistId)}
            className="w-full h-full object-cover"
          />
        </div>
        <h1 className="text-lg font-medium truncate">{artist?.name ?? '...'}</h1>
        <label className="text-xs text-neutral-400 hover:text-white underline cursor-pointer">
          {uploading ? '上传中...' : '上传头像'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUploadPicture}
            disabled={uploading}
            className="hidden"
          />
        </label>
        <span className="text-xs text-neutral-500 ml-auto">共 {songs.length} 首</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : songs.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该艺术家暂无关联曲目</div>
        ) : (
          <SongList
            songs={songs}
            currentSongId={currentSongId}
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
            refresh()
          }}
        />
      )}
    </div>
  )
}

interface LabelDetailProps {
  labelId: number
  onBack: () => void
}

/*
 * 厂牌二级详情页：按专辑分组展示旗下全部曲目（组内按碟号/曲目号排序），
 * 双击任一曲目将播放队列重置为该厂牌下全部专辑的全部曲目（跨专辑按分组顺序拼接）。
 */
function LabelDetail({ labelId, onBack }: LabelDetailProps): React.JSX.Element {
  const [label, setLabel] = useState<ArtistRow | null>(null)
  const [groups, setGroups] = useState<LabelAlbumGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<AlbumSongItem | null>(null)
  const [pictureVersion, setPictureVersion] = useState(0)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { queue, currentIndex, playQueue } = usePlayerStore()

  async function handleUploadPicture(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await window.api.artists.setManualPicture(labelId, bytes)
      setPictureVersion((v) => v + 1)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function load(): void {
    window.api.artists.labelDetail(labelId).then((detail) => {
      if (!detail) return
      setLabel(detail.label)
      setGroups(detail.groups)
      setLoading(false)
    })
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelId])

  const currentSongId = currentIndex !== null ? queue[currentIndex]?.songId ?? null : null
  const allSongs = groups.flatMap((g) => g.songs)

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-white/10 backdrop-blur-xl bg-neutral-900/70">
        <button
          onClick={onBack}
          className="text-neutral-400 hover:text-white text-sm transition-transform duration-150 ease-out active:scale-95"
        >
          ← 返回
        </button>
        <div className="w-8 h-8 rounded-full overflow-hidden bg-white/5 flex-shrink-0">
          <Cover
            cacheKey={`${labelId}-${pictureVersion}`}
            load={() => window.api.artists.picture(labelId)}
            className="w-full h-full object-cover"
          />
        </div>
        <h1 className="text-lg font-medium truncate">{label?.name ?? '...'}</h1>
        <label className="text-xs text-neutral-400 hover:text-white underline cursor-pointer">
          {uploading ? '上传中...' : '上传头像'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUploadPicture}
            disabled={uploading}
            className="hidden"
          />
        </label>
        <span className="text-xs text-neutral-500 ml-auto">
          {groups.length} 张专辑 · 共 {allSongs.length} 首
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : groups.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该厂牌暂无关联专辑</div>
        ) : (
          groups.map((group, gi) => {
            const offset = groups.slice(0, gi).reduce((n, g) => n + g.songs.length, 0)
            return (
              <div key={group.album.id} className="mb-4">
                <div className="sticky top-0 z-[1] px-4 py-1.5 text-xs text-neutral-400 backdrop-blur-xl bg-neutral-900/70">
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
                      allSongs.map(
                        (s): PlayerTrack => ({
                          key: `music-${s.id}`,
                          title: s.title,
                          artistNames: s.artistNames,
                          mediaUrl: window.api.songs.mediaUrl(s.file_name),
                          songId: s.id
                        })
                      ),
                      offset + index
                    )
                  }
                  onEdit={(song) => setEditingSong(song)}
                />
              </div>
            )
          })
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
