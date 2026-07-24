import { useEffect, useState, useRef } from 'react'
import { useLibraryStore, PAGE_SIZE } from '../stores/libraryStore'
import { usePlayerStore, type PlayerTrack } from '../stores/playerStore'
import SongList from '../components/SongList'
import SongEditModal from '../components/SongEditModal'
import type { SongListItem } from '../../../shared/types'
import { useNavStore } from '../stores/navStore'

/* Music 库列表视图：分页展示 songs 表，双击播放，"..." 进入编辑弹窗 */
export default function MusicView(): React.JSX.Element {
  const { songs, total, offset, loading, fetchPage } = useLibraryStore()
  const { queue, currentIndex, playQueue } = usePlayerStore()
  const [editingSong, setEditingSong] = useState<SongListItem | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { restoreSignal, clearRestoreSignal } = useNavStore()

  useEffect(() => {
    fetchPage(0)
  }, [fetchPage])

  /* 从 Artist/Album 详情页跨视图返回时，恢复之前记录的滚动位置 */
  useEffect(() => {
    if (!restoreSignal || restoreSignal.view !== 'music') return
    if (scrollRef.current) scrollRef.current.scrollTop = restoreSignal.scrollTop
    clearRestoreSignal()
  }, [restoreSignal, clearRestoreSignal])

  const currentSongId = currentIndex !== null ? queue[currentIndex]?.songId ?? null : null
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h1 className="text-lg font-medium">Music</h1>
        <span className="text-xs text-neutral-500">共 {total} 首</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 border-t border-white/10 text-sm">
          <button
            disabled={currentPage <= 1}
            onClick={() => fetchPage(offset - PAGE_SIZE)}
            className="disabled:opacity-30 disabled:cursor-not-allowed hover:text-white text-neutral-400"
          >
            上一页
          </button>
          <span className="text-neutral-500">
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => fetchPage(offset + PAGE_SIZE)}
            className="disabled:opacity-30 disabled:cursor-not-allowed hover:text-white text-neutral-400"
          >
            下一页
          </button>
        </div>
      )}

      {editingSong && (
        <SongEditModal
          songId={editingSong.id}
          onClose={() => setEditingSong(null)}
          onSaved={() => {
            setEditingSong(null)
            fetchPage(offset)
          }}
          returnContext={{ view: 'music', scrollTop: scrollRef.current?.scrollTop ?? 0 }}
        />
      )}
    </div>
  )
}
