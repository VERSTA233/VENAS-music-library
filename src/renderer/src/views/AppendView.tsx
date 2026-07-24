import { useEffect, useState } from 'react'
import type { AppendEntry } from '../../../shared/types'
import IngestModal from '../components/IngestModal'
import Cover from '../components/Cover'
import { usePlayerStore, type PlayerTrack } from '../stores/playerStore'

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/* Append 缓冲区看板：实时读取 Append/ 目录（不走数据库），手动刷新，点击"添加到音乐库"进入入库表单 */
export default function AppendView(): React.JSX.Element {
  const [entries, setEntries] = useState<AppendEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ingestingEntry, setIngestingEntry] = useState<AppendEntry | null>(null)
  const { queue, currentIndex, playQueue } = usePlayerStore()

  /* Append 试听队列与曲目对应关系用 fileName 作为 key，与 Music 队列（key 前缀 music-）区分开，避免误判为同一首在播放 */
  function toTrack(entry: AppendEntry): PlayerTrack {
    return {
      key: `append-${entry.fileName}`,
      title: entry.title,
      artistNames: entry.artist ?? '未知艺术家',
      mediaUrl: window.api.append.mediaUrl(entry.fileName),
      songId: null
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h1 className="text-lg font-medium">Append</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-sm px-3 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
        >
          {loading ? '扫描中...' : '刷新'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {!loading && entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">Append 目录为空</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.fileName}
              onDoubleClick={() => playQueue(entries.map(toTrack), index)}
              className={`group flex items-center gap-4 px-4 py-2 rounded cursor-default hover:bg-white/5 ${
                currentKey === `append-${entry.fileName}` ? 'bg-white/10' : ''
              }`}
            >
              <Cover
                cacheKey={entry.fileName}
                load={() => window.api.append.cover(entry.fileName)}
                className="w-9 h-9 rounded object-cover flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">{entry.title}</div>
                <div className="truncate text-xs text-neutral-500">{entry.artist || '未知艺术家'}</div>
              </div>
              <span className="text-xs text-neutral-500 w-12 text-right">{formatDuration(entry.duration)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIngestingEntry(entry)
                }}
                className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
              >
                添加到音乐库
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
    </div>
  )
}
