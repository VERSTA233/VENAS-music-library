import { useEffect, useState, useRef } from 'react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { toMusicPlayerTrack } from '../playerTracks'
import SongList from '../components/SongList'
import SongEditModal from '../components/SongEditModal'
import SongListToolbarActions from '../components/SongListToolbarActions'
import RandomPlayButton from '../components/RandomPlayButton'
import type { SongListItem } from '../../../shared/types'
import { useNavStore } from '../stores/navStore'

/* Music 库列表视图：完整展示 songs 表，双击播放，"..." 进入编辑弹窗。 */
export default function MusicView(): React.JSX.Element {
  const { songs, total, sort, query, loading, fetchSongs, setSort, setQuery } = useLibraryStore()
  const { queue, currentIndex, playQueue, playRandomQueue } = usePlayerStore()
  const [editingSong, setEditingSong] = useState<SongListItem | null>(null)
  const [searchInput, setSearchInput] = useState(query)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { restoreSignal, clearRestoreSignal } = useNavStore()

  useEffect(() => {
    fetchSongs()
  }, [fetchSongs])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [searchInput, setQuery])

  /* 从分类详情跨视图返回时，恢复搜索词与之前记录的滚动位置。 */
  useEffect(() => {
    if (!restoreSignal || restoreSignal.view !== 'music') return
    setSearchInput(restoreSignal.query)
    void setQuery(restoreSignal.query).finally(() => {
      window.requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = restoreSignal.scrollTop
      })
    })
    clearRestoreSignal()
  }, [restoreSignal, clearRestoreSignal, setQuery])

  const currentSongId = currentIndex !== null ? queue[currentIndex]?.songId ?? null : null
  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 justify-between border-b border-white/[0.08]">
        <div><h1 className="text-xl font-semibold leading-tight">Music</h1></div>
        <SongListToolbarActions
          query={searchInput}
          onQueryChange={setSearchInput}
          sort={sort}
          onSortChange={setSort}
          count={total}
          searchLabel="搜索音乐库"
          children={<RandomPlayButton onClick={() => playRandomQueue(songs.map(toMusicPlayerTrack))} disabled={songs.length === 0} />}
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : songs.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">音乐库为空，请先在 Append 中入库歌曲</div>
        ) : (
          <SongList
            songs={songs}
            currentSongId={currentSongId}
            onPlay={(index) =>
              playQueue(
                songs.map(toMusicPlayerTrack),
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
            fetchSongs()
          }}
          returnContext={{ view: 'music', scrollTop: scrollRef.current?.scrollTop ?? 0, query: searchInput }}
        />
      )}
    </div>
  )
}
