import { useEffect, useState } from 'react'
import { CirclePlus, FileOutput, Inbox, RefreshCw, TriangleAlert, X } from 'lucide-react'
import type { AppendEntry, NeteaseImportResult } from '../../../shared/types'
import IngestModal from '../components/IngestModal'
import Cover from '../components/Cover'
import { usePlayerStore, type PlayerTrack } from '../stores/playerStore'
import RandomPlayButton from '../components/RandomPlayButton'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/* Append 缓冲区看板：实时读取 Append/ 目录（不走数据库），手动刷新，点击"添加到音乐库"进入入库表单 */
export default function AppendView(): React.JSX.Element {
  const [entries, setEntries] = useState<AppendEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ingestingEntry, setIngestingEntry] = useState<AppendEntry | null>(null)
  const [importingNetease, setImportingNetease] = useState(false)
  const [neteaseResult, setNeteaseResult] = useState<NeteaseImportResult | null>(null)
  const [neteaseError, setNeteaseError] = useState<string | null>(null)
  const { queue, currentIndex, playQueue, playRandomQueue } = usePlayerStore()

  /* Append 试听队列与曲目对应关系用 fileName 作为 key，与 Music 队列（key 前缀 music-）区分开，避免误判为同一首在播放 */
  function toTrack(entry: AppendEntry): PlayerTrack {
    return {
      key: `append-${entry.fileName}`,
      title: entry.title,
      artistNames: entry.artist ?? '未知艺术家',
      mediaUrl: window.api.append.mediaUrl(entry.fileName),
      songId: null,
      appendEntry: entry
    }
  }

  const currentKey = currentIndex !== null ? queue[currentIndex]?.key ?? null : null

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      setEntries(await window.api.append.scan())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function importNeteaseMusic(): Promise<void> {
    setImportingNetease(true)
    setNeteaseError(null)
    try {
      setNeteaseResult(await window.api.append.importNeteaseMusic())
    } catch (reason) {
      setNeteaseError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImportingNetease(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 justify-between border-b border-white/[0.08]">
        <div><h1 className="text-xl font-semibold leading-tight">Append</h1></div>
        <div className="flex items-center gap-2">
          <RandomPlayButton onClick={() => playRandomQueue(entries.map(toTrack))} disabled={entries.length === 0 || loading || importingNetease} />
          <button
            type="button"
            onClick={importNeteaseMusic}
            disabled={importingNetease}
            className="library-icon-button disabled:opacity-30"
            title={importingNetease ? '正在解码并导入' : '解码网易云音乐'}
            aria-label={importingNetease ? '正在解码并导入' : '解码网易云音乐'}
          >
            <FileOutput size={17} className={importingNetease ? 'animate-pulse' : ''} />
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading || importingNetease}
            className="library-icon-button disabled:opacity-30"
            title={loading ? '扫描中' : '刷新'}
            aria-label={loading ? '扫描中' : '刷新'}
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {neteaseError && <p className="px-4 pt-3 text-xs text-red-400">{neteaseError}</p>}

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {!loading && entries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center text-sm text-neutral-500"><Inbox size={28} strokeWidth={1.5} className="text-neutral-600" />Append 目录为空</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.fileName}
              onMouseDown={(event) => {
                if (event.detail === 2) event.preventDefault()
              }}
              onDoubleClick={(event) => {
                event.preventDefault()
                playQueue(entries.map(toTrack), index)
              }}
            className={`library-row group flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5 cursor-default hover:bg-white/[0.06] ${
                currentKey === `append-${entry.fileName}` ? 'bg-white/[0.11] ring-1 ring-white/[0.06]' : ''
              }`}
            >
              <span className="w-7 shrink-0 text-center text-sm font-mono leading-none tabular-nums text-neutral-500">{index + 1}</span>
              <Cover
                cacheKey={entry.fileName}
                load={() => window.api.append.cover(entry.fileName)}
                className="h-10 w-10 shrink-0 rounded-lg object-cover shadow-sm"
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-neutral-100">{entry.title}</div>
                <div className="truncate text-xs text-neutral-500">{entry.artist || '未知艺术家'}</div>
              </div>
              <span className="w-12 shrink-0 text-right text-sm font-mono leading-none tabular-nums text-neutral-500">{formatDuration(entry.duration)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIngestingEntry(entry)
                }}
                className="library-icon-button opacity-0 group-hover:opacity-100"
                title="添加到音乐库"
                aria-label="添加到音乐库"
              >
                <CirclePlus size={19} />
              </button>
            </div>
          ))
        )}
      </div>

      {ingestingEntry && (
        <IngestModal
          entry={ingestingEntry}
          onClose={() => setIngestingEntry(null)}
          onIngested={() => {
            setIngestingEntry(null)
            refresh()
          }}
        />
      )}
      {neteaseResult && (
        <div className={`modal-safe-area fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm${currentIndex !== null ? ' pb-[92px]' : ''}`} role="dialog" aria-modal="true" aria-labelledby="netease-import-title">
          <div className={`flex w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1b1b1f]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl ${currentIndex !== null ? 'max-h-[calc(100dvh-140px)]' : 'max-h-[calc(100dvh-4rem)]'}`}>
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
              <div className="flex items-baseline gap-3">
                <h2 id="netease-import-title" className="text-base font-semibold text-white">新加入的音乐</h2>
                <span className="font-mono text-xs tabular-nums text-neutral-500">{neteaseResult.audioFiles.length} 首</span>
              </div>
              <button
                type="button"
                className="library-icon-button"
                onClick={() => {
                  setNeteaseResult(null)
                  refresh()
                }}
                title="关闭"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {neteaseResult.audioFiles.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-16 text-center text-sm text-neutral-500"><Inbox size={28} strokeWidth={1.5} className="text-neutral-600" />没有可加入的音频文件</div>
              ) : (
                neteaseResult.audioFiles.map((fileName, index) => (
                  <div key={fileName} className="library-row flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5">
                    <span className="w-7 shrink-0 text-center text-sm font-mono leading-none tabular-nums text-neutral-500">{index + 1}</span>
                    <FileOutput size={18} className="shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">{fileName}</span>
                  </div>
                ))
              )}
              {neteaseResult.failedFiles.length > 0 && (
                <div className="mt-4 flex items-center gap-2 px-3 text-xs text-amber-300/75"><TriangleAlert size={15} />{neteaseResult.failedFiles.length} 个文件未能处理，源文件已保留。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
