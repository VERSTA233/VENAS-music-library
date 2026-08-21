import type { SongListItem } from '../../../shared/types'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import Cover from './Cover'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface SongListProps<T extends SongListItem> {
  songs: T[]
  currentSongId: number | null
  onPlay: (index: number) => void
  onEdit: (song: T) => void
  /* 可选：自定义每行最左侧序号展示内容（如专辑详情页展示曲目号/碟号），不传则默认显示 index + 1 */
  renderLeading?: (song: T, index: number) => React.ReactNode
  /* 专辑详情已在顶栏展示统一封面，曲目行可隐藏重复的歌曲封面。 */
  showCover?: boolean
  /* 可选：在“...”编辑按钮左侧插入额外操作按钮（如 Tag 详情页的评论/移除按钮） */
  renderActions?: (song: T, index: number) => React.ReactNode
  /* 可选：在这一行下方插入额外内容（如 Tag 详情页的评论深色栏），不影响双击播放等行为 */
  renderBelow?: (song: T, index: number) => React.ReactNode
  /* 可选：传入后启用手柄拖拽排序；调用方在拖动结束时持久化新顺序。 */
  onReorder?: (songs: T[]) => void
  onReorderEnd?: () => void
}

interface SongListRowProps<T extends SongListItem> extends Omit<SongListProps<T>, 'songs' | 'onReorder' | 'onReorderEnd'> {
  song: T
  index: number
  onStartDrag?: (event: React.PointerEvent<HTMLButtonElement>) => void
}

function SongListRow<T extends SongListItem>({
  song,
  index,
  currentSongId,
  onPlay,
  onEdit,
  renderLeading,
  showCover = true,
  renderActions,
  renderBelow,
  onStartDrag
}: SongListRowProps<T>): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <div
        onMouseDown={(event) => {
          if (event.detail === 2) event.preventDefault()
        }}
        onDoubleClick={(event) => {
          event.preventDefault()
          onPlay(index)
        }}
        className={`library-row group flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5 cursor-default hover:bg-white/[0.06] ${
          song.id === currentSongId ? 'bg-white/[0.11] ring-1 ring-white/[0.06]' : ''
        }`}
      >
        {onStartDrag && (
          <button
            type="button"
            onPointerDown={onStartDrag}
            className="-ml-1 flex h-8 w-4 shrink-0 touch-none cursor-grab items-center justify-center text-neutral-600 transition hover:text-neutral-300 active:cursor-grabbing"
            aria-label="拖拽调整顺序"
          >
            <GripVertical size={17} />
          </button>
        )}
        <span className="w-7 shrink-0 text-center text-sm font-mono leading-none tabular-nums text-neutral-500">
          {renderLeading ? renderLeading(song, index) : index + 1}
        </span>
        {showCover && (
          <Cover
            cacheKey={song.id}
            load={() => window.api.songs.cover(song.id)}
            className="h-10 w-10 shrink-0 rounded-lg object-cover shadow-sm"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-neutral-100">{song.title}</div>
          <div className="truncate text-xs text-neutral-500">{song.artistNames || '未知艺术家'}</div>
        </div>
        <span className="w-12 shrink-0 text-right text-sm font-mono leading-none tabular-nums text-neutral-500">{formatDuration(song.length)}</span>
        {renderActions?.(song, index)}
        <button
          onClick={(event) => {
            event.stopPropagation()
            onEdit(song)
          }}
          className="library-icon-button opacity-0 group-hover:opacity-100"
          title="更多"
          aria-label="更多"
        >
          <MoreHorizontal size={19} />
        </button>
      </div>
      {renderBelow?.(song, index)}
    </div>
  )
}

function SortableSongListRow<T extends SongListItem>({
  onReorderEnd,
  ...rowProps
}: SongListRowProps<T> & { onReorderEnd: () => void }): React.JSX.Element {
  const dragControls = useDragControls()

  return (
    <Reorder.Item value={rowProps.song} drag="y" dragListener={false} dragControls={dragControls} onDragEnd={onReorderEnd} className="list-none">
      <SongListRow
        {...rowProps}
        onStartDrag={(event) => {
          event.stopPropagation()
          dragControls.start(event)
        }}
      />
    </Reorder.Item>
  )
}

/* Music/Artist/Album/Tag 通用曲目列表：Tag 传入重排回调时额外启用拖拽手柄。 */
export default function SongList<T extends SongListItem>({
  songs,
  currentSongId,
  onPlay,
  onEdit,
  renderLeading,
  showCover,
  renderActions,
  renderBelow,
  onReorder,
  onReorderEnd
}: SongListProps<T>): React.JSX.Element {
  const rowProps = (song: T, index: number): SongListRowProps<T> => ({
    song,
    index,
    currentSongId,
    onPlay,
    onEdit,
    renderLeading,
    showCover,
    renderActions,
    renderBelow
  })

  if (onReorder && onReorderEnd) {
    return (
      <Reorder.Group axis="y" values={songs} onReorder={onReorder} className="flex flex-col gap-0.5 px-3 py-2">
        {songs.map((song, index) => <SortableSongListRow key={song.id} {...rowProps(song, index)} onReorderEnd={onReorderEnd} />)}
      </Reorder.Group>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      {songs.map((song, index) => <SongListRow key={song.id} {...rowProps(song, index)} />)}
    </div>
  )
}
