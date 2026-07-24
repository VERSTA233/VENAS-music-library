import type { SongListItem } from '../../../shared/types'
import Cover from './Cover'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface SongListProps<T extends SongListItem> {
  songs: T[]
  currentSongId: number | null
  onPlay: (index: number) => void
  onEdit: (song: T) => void
  /* 可选：自定义每行最左侧序号展示内容（如专辑详情页展示曲目号/碟号），不传则默认显示 index + 1 */
  renderLeading?: (song: T, index: number) => React.ReactNode
}

/* Music/Artist/Album 通用曲目列表：双击整行播放（重置队列为当前屏幕顺序），"..." 按钮进入编辑 */
export default function SongList<T extends SongListItem>({
  songs,
  currentSongId,
  onPlay,
  onEdit,
  renderLeading
}: SongListProps<T>): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {songs.map((song, index) => (
        <div
          key={song.id}
          onDoubleClick={() => onPlay(index)}
          className={`group flex items-center gap-4 px-4 py-2 rounded cursor-default hover:bg-white/5 ${
            song.id === currentSongId ? 'bg-white/10' : ''
          }`}
        >
          <span className="w-8 text-right text-sm text-neutral-500">
            {renderLeading ? renderLeading(song, index) : index + 1}
          </span>
          <Cover
            cacheKey={song.id}
            load={() => window.api.songs.cover(song.id)}
            className="w-9 h-9 rounded object-cover flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm">{song.title}</div>
            <div className="truncate text-xs text-neutral-500">{song.artistNames || '未知艺术家'}</div>
          </div>
          <span className="text-xs text-neutral-500 w-12 text-right">{formatDuration(song.length)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit(song)
            }}
            className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-200 px-2"
            title="更多"
          >
            ···
          </button>
        </div>
      ))}
    </div>
  )
}
