import { Pause, Play, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import type { PlaybackMode } from '../stores/playerStore'

interface PlaybackControlsProps {
  variant: 'compact' | 'full'
  isPlaying: boolean
  playbackMode: PlaybackMode
  onToggleMode: () => void
  onPrevious: () => void
  onTogglePlay: () => void
  onNext: () => void
}

/* 底部条和全屏层共享同一组播放语义，仅根据可用空间改变尺寸与视觉层级。 */
export default function PlaybackControls({ variant, isPlaying, playbackMode, onToggleMode, onPrevious, onTogglePlay, onNext }: PlaybackControlsProps): React.JSX.Element {
  const modeTitle = playbackMode === 'shuffle' ? '切换为顺序循环播放' : '切换为随机播放'
  if (variant === 'compact') {
    return (
      <>
        <button type="button" onClick={onToggleMode} className={`rounded p-1 transition active:scale-95 ${playbackMode === 'shuffle' ? 'text-white' : 'text-neutral-600 hover:text-neutral-300'}`} title={playbackMode === 'shuffle' ? '随机播放' : '顺序循环播放'} aria-label={modeTitle}><Shuffle size={16} /></button>
        <button type="button" onClick={onPrevious} className="text-neutral-400 transition active:scale-95 hover:text-white" title="上一首" aria-label="上一首"><SkipBack size={18} fill="currentColor" /></button>
        <button type="button" onClick={onTogglePlay} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition active:scale-95" title={isPlaying ? '暂停' : '播放'} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause size={15} fill="currentColor" /> : <Play className="ml-0.5" size={15} fill="currentColor" />}</button>
        <button type="button" onClick={onNext} className="text-neutral-400 transition active:scale-95 hover:text-white" title="下一首" aria-label="下一首"><SkipForward size={18} fill="currentColor" /></button>
      </>
    )
  }

  return (
    <>
      <button type="button" onClick={onToggleMode} className={`flex h-12 w-12 items-center justify-center rounded-full transition active:scale-95 ${playbackMode === 'shuffle' ? 'bg-white text-black' : 'text-neutral-300 hover:bg-white/10 hover:text-white'}`} title={modeTitle} aria-label={modeTitle}><Shuffle size={21} /></button>
      <button type="button" onClick={onPrevious} className="flex h-12 w-12 items-center justify-center rounded-full text-neutral-300 transition active:scale-95 hover:bg-white/10 hover:text-white" title="上一首" aria-label="上一首"><SkipBack size={21} fill="currentColor" /></button>
      <button type="button" onClick={onTogglePlay} className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition active:scale-95 hover:bg-neutral-200" title={isPlaying ? '暂停' : '播放'} aria-label={isPlaying ? '暂停' : '播放'}>{isPlaying ? <Pause size={21} fill="currentColor" /> : <Play className="ml-0.5" size={21} fill="currentColor" />}</button>
      <button type="button" onClick={onNext} className="flex h-12 w-12 items-center justify-center rounded-full text-neutral-300 transition active:scale-95 hover:bg-white/10 hover:text-white" title="下一首" aria-label="下一首"><SkipForward size={21} fill="currentColor" /></button>
    </>
  )
}
