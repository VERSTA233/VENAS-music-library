import { useEffect, useRef, useState } from 'react'
import { FolderOpen, ListMusic } from 'lucide-react'
import type { MissingAudioFile, PlaylistExportInspection, PlaylistExportResult } from '../../../shared/types'

export default function PlaylistExportSettings({ musicRoot }: { musicRoot: string | null }): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'generating'>('idle')
  const [inspection, setInspection] = useState<PlaylistExportInspection | null>(null)
  const [result, setResult] = useState<PlaylistExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const tokenRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const busy = phase !== 'idle'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (tokenRef.current) void window.api.library.cancelPlaylistExport(tokenRef.current).catch(() => undefined)
    }
  }, [])

  async function generate(token: string, skipMissing: boolean): Promise<void> {
    setPhase('generating')
    setError(null)
    try {
      const outcome = await window.api.library.generatePlaylists(token, skipMissing)
      if (!mountedRef.current) return
      if (outcome.status === 'confirmation-required') {
        setInspection(outcome.inspection)
      } else {
        tokenRef.current = null
        setInspection(null)
        setResult(outcome.result)
      }
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (mountedRef.current) setPhase('idle')
      else void window.api.library.cancelPlaylistExport(token).catch(() => undefined)
    }
  }

  async function start(): Promise<void> {
    if (busy || inspection) return
    setPhase('checking')
    setError(null)
    setResult(null)
    try {
      const checked = await window.api.library.inspectPlaylistExport()
      if (!mountedRef.current) {
        await window.api.library.cancelPlaylistExport(checked.token)
        return
      }
      tokenRef.current = checked.token
      if (checked.missingFiles.length > 0) setInspection(checked)
      else await generate(checked.token, false)
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (mountedRef.current) setPhase('idle')
    }
  }

  function cancel(): void {
    if (busy || !inspection) return
    void window.api.library.cancelPlaylistExport(inspection.token).catch(() => undefined)
    tokenRef.current = null
    setInspection(null)
    setError(null)
  }

  async function openFolder(): Promise<void> {
    setOpening(true)
    setError(null)
    try {
      await window.api.library.openPlaylistFolder()
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (mountedRef.current) setOpening(false)
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Playlist</h2>
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
        <div className="flex min-h-22 items-center gap-4 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-neutral-300"><ListMusic size={19} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-neutral-200">生成 Tag 歌单</div>
            <p className="mt-1 text-xs leading-5 text-neutral-500">按 Tag 类型和曲目顺序导出全部 M3U，每次完整替换上次结果。</p>
            <p className="mt-1 break-all text-xs text-neutral-500">{musicRoot ? `${musicRoot}/Music/Playlist` : '加载中...'}</p>
          </div>
          <button type="button" onClick={() => void start()} disabled={busy || inspection != null || !musicRoot} className="shrink-0 rounded-lg bg-white/[0.08] px-3 py-2 text-xs text-neutral-200 transition hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
            {phase === 'checking' ? '检查音频中...' : phase === 'generating' ? '生成中...' : '生成 Playlist'}
          </button>
        </div>
        {result && (
          <div className="border-t border-white/[0.08] px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <p role="status" className="text-sm text-neutral-200">已生成 {result.typeCount} 个类型、{result.playlistCount} 个歌单</p>
              <button type="button" onClick={() => void openFolder()} disabled={opening} className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs text-neutral-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"><FolderOpen size={15} />打开文件夹</button>
            </div>
            <p className="mt-1 text-xs leading-5 text-neutral-400">包含 {result.songCount} 首独立歌曲，共 {result.entryCount} 条歌曲条目。同一首歌出现在多个 Tag 中会分别计入条目。</p>
            {result.skippedFiles.length > 0 && <><p className="mt-3 text-xs text-amber-200">已跳过 {result.skippedFiles.length} 首缺失音频（含未关联 Tag 的歌曲）。</p><MissingFileList files={result.skippedFiles} /></>}
            {result.warnings.map((warning) => <p key={warning} className="mt-2 break-all text-xs text-amber-200">{warning}</p>)}
          </div>
        )}
      </div>
      {error && !inspection && <p role="alert" className="mt-3 break-all text-xs text-red-400">{error}</p>}
      {inspection && (
        <div className="modal-safe-area fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="playlist-export-title">
          <div className="flex max-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-dialog shadow-2xl">
            <header className="window-drag-region shrink-0 border-b border-white/[0.08] px-6 py-5">
              <h2 id="playlist-export-title" className="text-base font-semibold text-white">音频文件缺失</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-400">有 {inspection.missingFiles.length} 首歌曲找不到音频。继续生成将跳过这些歌曲；取消会保留上次歌单。</p>
            </header>
            <div className="min-h-0 overflow-y-auto px-6 py-4"><MissingFileList files={inspection.missingFiles} />{error && <p role="alert" className="mt-3 break-all text-xs text-red-400">{error}</p>}</div>
            <footer className="flex shrink-0 justify-end gap-3 border-t border-white/[0.08] px-6 py-4">
              <button type="button" onClick={cancel} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40">取消</button>
              <button type="button" onClick={() => void generate(inspection.token, true)} disabled={busy} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-40">{busy ? '生成中...' : '跳过缺失并继续生成'}</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}

function MissingFileList({ files }: { files: MissingAudioFile[] }): React.JSX.Element {
  return (
    <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-lg bg-black/20 p-3">
      {files.map((file) => <li key={file.songId}><div className="break-words text-sm text-neutral-200">{file.title}</div><div className="mt-0.5 break-all text-xs text-neutral-500">{file.fileName}</div></li>)}
    </ul>
  )
}
