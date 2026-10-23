import { useEffect, useRef, useState } from 'react'
import { ListMusic, MoreHorizontal } from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'
import SongEditModal from './SongEditModal'
import IngestModal from './IngestModal'
import PlaybackCover from './PlaybackCover'
import PlaybackControls from './PlaybackControls'
import QueuePanel from './QueuePanel'
import type { AppendEntry } from '../../../shared/types'
import PlaybackProgress from './PlaybackProgress'
import VolumeControl from './VolumeControl'

/* 底部条与全屏层共用播放状态；音频引擎独立常驻。 */
export default function BottomPlayerBar({ hidden, onOpenFullPlayer }: { hidden: boolean; onOpenFullPlayer: () => void }): React.JSX.Element | null {
  const { queue, currentIndex, isPlaying, isAdvancing, togglePlay, playNext, playPrev, playAt, playbackMode, setPlaybackMode, currentTime, duration } = usePlayerStore()
  const [editingSongId, setEditingSongId] = useState<number | null>(null)
  const [ingestingEntry, setIngestingEntry] = useState<AppendEntry | null>(null)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const playlistRef = useRef<HTMLDivElement>(null)
  const playlistTriggerRef = useRef<HTMLButtonElement>(null)
  const currentTrack = currentIndex == null ? null : queue[currentIndex] ?? null
  useEffect(() => {
    if (!playlistOpen) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      const target = event.target as Node
      if (playlistRef.current?.contains(target) || playlistTriggerRef.current?.contains(target)) return
      setPlaylistOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [playlistOpen])

  if (!currentTrack) return null
  const track = currentTrack

  function openTrackDetail(): void {
    if (track.songId != null) setEditingSongId(track.songId)
    else if (track.appendEntry) setIngestingEntry(track.appendEntry)
  }

  return (
    <>
      <div className={`relative z-[90] grid h-[76px] shrink-0 grid-cols-[minmax(180px,0.6fr)_auto_auto_auto_auto_minmax(180px,2fr)_auto_auto_auto] items-center gap-3 border-t border-white/[0.08] bg-neutral-950/95 px-4 backdrop-blur-xl transition-opacity ${hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
        <button type="button" onClick={onOpenFullPlayer} className="group flex min-w-0 items-center gap-3 text-left" title="打开全屏播放界面">
          <PlaybackCover track={track} className="h-11 w-11 shrink-0 rounded-lg object-cover shadow-lg transition duration-200 group-active:scale-95" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">{track.title}</span>
            <span className="block truncate text-xs text-neutral-500">{track.artistNames}</span>
          </span>
        </button>

        <PlaybackControls variant="compact" isPlaying={isPlaying} playbackMode={playbackMode} onToggleMode={() => setPlaybackMode(playbackMode === 'shuffle' ? 'sequential' : 'shuffle')} onPrevious={playPrev} onTogglePlay={togglePlay} onNext={playNext} />
        <PlaybackProgress currentTime={currentTime} duration={duration} isPlaying={isPlaying && isAdvancing} onSeek={(time) => usePlayerStore.getState().requestSeek(time)} />
        <VolumeControl />

        <button type="button" onClick={openTrackDetail} className="rounded p-2 text-neutral-500 transition active:scale-95 hover:bg-white/10 hover:text-white" title="歌曲信息 / 添加到音乐库" aria-label="歌曲信息 / 添加到音乐库"><MoreHorizontal size={20} /></button>
        <button ref={playlistTriggerRef} type="button" onClick={() => setPlaylistOpen((value) => !value)} className={`rounded p-2 transition active:scale-95 hover:bg-white/10 ${playlistOpen ? 'text-white' : 'text-neutral-500 hover:text-white'}`} title="当前播放列表" aria-label="当前播放列表"><ListMusic size={19} /></button>

        <QueuePanel open={playlistOpen} variant="bottom" queue={queue} currentIndex={currentIndex} onPlayAt={playAt} onClose={() => setPlaylistOpen(false)} panelRef={playlistRef} />
      </div>

      {editingSongId != null && <SongEditModal songId={editingSongId} onClose={() => setEditingSongId(null)} onSaved={() => setEditingSongId(null)} />}
      {ingestingEntry && <IngestModal entry={ingestingEntry} onClose={() => setIngestingEntry(null)} onIngested={() => setIngestingEntry(null)} />}
    </>
  )
}
