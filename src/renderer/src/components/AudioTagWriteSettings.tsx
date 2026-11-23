import { Tags } from 'lucide-react'
import type { AudioTagWriteProgress } from '../../../shared/types'
import { useTaskProgress } from '../hooks/useTaskProgress'
import SettingRow from './SettingRow'
import TaskProgressPanel from './TaskProgressPanel'

const phases: Record<AudioTagWriteProgress['phase'], string> = {
  checking: '核对文件与记录', preparing: '写入标签', validating: '校验音频与标签', committing: '保存文件'
}

export default function AudioTagWriteSettings(): React.JSX.Element {
  const { progress, loading, requesting, error, busy, act } = useTaskProgress({
    getProgress: window.api.library.getAudioTagProgress,
    subscribe: window.api.library.onAudioTagProgress,
    start: window.api.library.startAudioTagWrite,
    cancel: window.api.library.cancelAudioTagWrite
  })

  const percent = progress ? (progress.total ? Math.round(progress.completed / progress.total * 100) : 100) : 0
  const status = progress?.status === 'cancelling' ? '正在完成当前歌曲，随后停止' : busy ? `${phases[progress!.phase]} · ${percent}%` : progress?.status === 'cancelled' ? '已停止，下次将从未完成项继续' : progress?.status === 'failed' ? '任务中断，可重新开始重试' : '本次写入已完成'

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">音频标签</h2>
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
        <SettingRow icon={<Tags size={19} />} title="将歌曲信息写入源文件" description="将音乐库信息同步到音频标签，保留封面。已成功且未变更的文件自动跳过。" action={progress?.status === 'cancelling' ? '正在停止…' : busy ? '停止写入' : '一键写入'} onClick={() => void act()} disabled={loading || requesting || progress?.status === 'cancelling'} />
        {progress && <TaskProgressPanel status={status} progress={progress} label="标签写入进度" summary={`已写入 ${progress.written} 首 · 已跳过 ${progress.skipped} 首 · 失败 ${progress.failed} 首${busy ? '。离开此页面不会中断任务。' : ''}`}>
          {!!progress.errors.length && <details className="mt-3 text-xs text-neutral-400">
            <summary className="cursor-pointer text-amber-200/80">查看失败详情（{progress.errors.length}）</summary>
            <ul className="mt-2 max-h-48 space-y-3 overflow-y-auto rounded-lg bg-black/20 p-3">{progress.errors.map((item, index) => <li key={`${item.songId}-${index}`}><div className="text-neutral-300">{item.title}</div><div className="mt-1 break-all">{item.fileName} · {item.message}</div></li>)}</ul>
          </details>}
        </TaskProgressPanel>}
      </div>
      {error && <p role="alert" className="mt-3 break-all text-xs text-red-400">{error}</p>}
    </section>
  )
}
