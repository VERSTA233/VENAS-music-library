import type { ReactNode } from 'react'

interface TaskProgressPanelProps {
  status: string
  progress: {
    completed: number
    total: number
    currentSong: { title: string; fileName: string } | null
  }
  label: string
  summary: string
  showProgress?: boolean
  children?: ReactNode
}

/* 标签写入和编码检查共用进度布局，各自保留状态文案和结果列表。 */
export default function TaskProgressPanel({ status, progress, label, summary, showProgress = true, children }: TaskProgressPanelProps): React.JSX.Element {
  return <div className="border-t border-white/[0.08] px-5 py-4">
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-300">
      <span>{status}</span>
      {showProgress && <span className="font-mono tabular-nums">{progress.completed} / {progress.total}</span>}
    </div>
    {showProgress && <>
      <progress aria-label={label} value={progress.completed} max={progress.total || 1} className="mt-3 block h-1 w-full overflow-hidden rounded-full border-0 bg-white/[0.08] accent-emerald-400 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-white/[0.08] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-emerald-400" />
      {progress.currentSong && <p className="mt-2 truncate text-xs text-neutral-400" title={progress.currentSong.fileName}>{progress.currentSong.title}</p>}
      <p className="mt-2 text-xs leading-5 text-neutral-500">{summary}</p>
    </>}
    {children}
  </div>
}
