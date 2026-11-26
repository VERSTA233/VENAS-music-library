import { AudioLines } from 'lucide-react'
import SettingRow from './SettingRow'
import TaskProgressPanel from './TaskProgressPanel'
import { useTaskProgress } from '../hooks/useTaskProgress'
import { memo } from 'react'
import type { AudioIntegrityProgress, AudioIntegrityProgressUpdate } from '../../../shared/types'

function mergeProgress(current: AudioIntegrityProgress, update: AudioIntegrityProgressUpdate): AudioIntegrityProgress {
  const { issueChanges, ...progress } = update
  if (issueChanges.length === 0) return { ...progress, issues: current.issues }
  const issues = new Map(current.issues.map(issue => [issue.songId, issue]))
  for (const { songId, issue } of issueChanges) {
    if (issue) issues.set(songId, issue)
    else issues.delete(songId)
  }
  return { ...progress, issues: [...issues.values()].sort((a, b) => a.songId - b.songId) }
}

/* 计数变化时保留问题清单引用，无需重复渲染已经展示的诊断。 */
const IntegrityIssues = memo(function IntegrityIssues({ issues, busy, completed }: {
  issues: AudioIntegrityProgress['issues']; busy: boolean; completed: boolean
}) {
  return <>
    {issues.length > 0 ? <ul aria-label="存在问题的歌曲" className="mt-3 max-h-80 space-y-4 overflow-y-auto rounded-lg bg-black/20 p-3">
      {issues.map(issue => <li key={issue.songId} className="text-xs leading-5">
        <div className="text-neutral-200">{issue.title}<span className="ml-2 text-amber-200/75">{issue.kind === 'failed' ? '未能完成检查' : '解码诊断'}</span></div>
        <p className="break-all text-neutral-500">{issue.fileName}</p>
        <p className="mt-1 whitespace-pre-wrap break-all text-neutral-400">{issue.message}</p>
      </li>)}
    </ul> : <p className="mt-3 text-xs text-neutral-500">{busy ? '暂未发现问题' : completed ? '未发现解码问题' : '暂无已记录的问题'}</p>}
    {issues.length > 0 && <p className="mt-2 text-xs leading-5 text-neutral-500">只展示本次检查有问题或未能完成检查的歌曲；下次检查会重试这些文件。</p>}
  </>
})

export default function AudioIntegritySettings(): React.JSX.Element {
  const { progress, loading, requesting, error, busy, act } = useTaskProgress({
    getProgress: window.api.library.getAudioIntegrityProgress,
    subscribe: window.api.library.onAudioIntegrityProgress,
    start: window.api.library.startAudioIntegrityScan,
    cancel: window.api.library.cancelAudioIntegrityScan,
    merge: mergeProgress
  })

  const labels = { idle: '已保存的检查结果', running: progress?.phase === 'decoding' ? '正在解码检查' : '正在核对文件', cancelling: '正在停止', completed: '检查完成', cancelled: '已停止，未完成项下次重试', failed: '检查中断，请重试' }
  return <section>
    <h2 className="mb-3 text-sm font-semibold text-neutral-200">音频编码检查</h2>
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
      <SettingRow icon={<AudioLines size={19} />} title="检查歌曲能否完整解码" description="只读检查。重启后清空结果；正常且未变化的文件可跳过，问题或未完成项每次重试。" action={progress?.status === 'cancelling' ? '正在停止…' : busy ? '停止检查' : '开始检查'} onClick={() => void act()} disabled={loading || requesting || progress?.status === 'cancelling'} />
      {progress && <TaskProgressPanel status={labels[progress.status]} progress={progress} label="编码检查进度" showProgress={progress.status !== 'idle'} summary={`已解码 ${progress.scanned} 首 · 未变化跳过 ${progress.skipped} 首 · 未完成 ${progress.failed} 首${busy ? '。离开此页面后继续检查。' : ''}`}>
        <IntegrityIssues issues={progress.issues} busy={busy} completed={progress.status === 'completed'} />
      </TaskProgressPanel>}
    </div>
    {(error || progress?.error) && <p role="alert" className="mt-3 break-all text-xs text-red-400">{error || progress?.error}</p>}
  </section>
}
