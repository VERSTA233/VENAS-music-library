import { useState } from 'react'
import type { AlbumMatchCandidate } from '../../../shared/types'
import {
  type AlbumFormState,
  albumFieldsDirty,
  applyAlbumCandidate
} from './AlbumPicker'

/* check() 的返回结果：proceed=false 时 album 是已还原/待用户重新处理的值，调用方应回填表单且不要提交 */
export interface AlbumGuardResult {
  proceed: boolean
  album: AlbumFormState
}

type PendingState =
  | { kind: 'dedupe'; album: AlbumFormState; candidates: AlbumMatchCandidate[]; resolve: (r: AlbumGuardResult) => void }
  | { kind: 'change'; album: AlbumFormState; resolve: (r: AlbumGuardResult) => void }
  | null

/*
 * 专辑黄灯/绿灯脏改动的提交前拦截：
 * - 黄灯（存在同名专辑但未选定）：弹出去重确认框，用户选定其一或确认新建。
 * - 绿灯 + 字段被手动改动：弹出改动确认框，用户确认应用改动到共享专辑，或撤回改动。
 * 供 IngestModal/SongEditModal 在提交前调用 check()，据返回结果决定是否继续提交。
 */
export function useAlbumSubmitGuard(): { check: (album: AlbumFormState) => Promise<AlbumGuardResult>; dialog: React.JSX.Element | null } {
  const [pending, setPending] = useState<PendingState>(null)

  async function check(album: AlbumFormState): Promise<AlbumGuardResult> {
    const title = album.title.trim()
    if (!title) return { proceed: true, album }

    if (album.selectedAlbumId == null) {
      const results = await window.api.albums.search(title)
      const candidates = results.filter((a) => a.title.trim().toLowerCase() === title.toLowerCase())
      if (candidates.length === 0) return { proceed: true, album }
      return new Promise<AlbumGuardResult>((resolve) => {
        setPending({ kind: 'dedupe', album, candidates, resolve })
      })
    }

    if (!albumFieldsDirty(album)) return { proceed: true, album }
    return new Promise<AlbumGuardResult>((resolve) => {
      setPending({ kind: 'change', album, resolve })
    })
  }

  async function handlePickCandidate(candidate: AlbumMatchCandidate): Promise<void> {
    if (!pending || pending.kind !== 'dedupe') return
    const detail = await window.api.albums.detail(candidate.id)
    const album = applyAlbumCandidate(pending.album, candidate, detail?.artists ?? [])
    pending.resolve({ proceed: false, album }) // 回填表单后需用户再次点击提交，不直接继续本次提交
    setPending(null)
  }

  function handleCreateNew(): void {
    if (!pending || pending.kind !== 'dedupe') return
    pending.resolve({ proceed: true, album: pending.album })
    setPending(null)
  }

  function handleApplyChange(): void {
    if (!pending || pending.kind !== 'change') return
    pending.resolve({ proceed: true, album: pending.album })
    setPending(null)
  }

  function handleRevertChange(): void {
    if (!pending || pending.kind !== 'change') return
    const snapshot = pending.album.selectedAlbumSnapshot
    const reverted: AlbumFormState = snapshot
      ? {
          ...pending.album,
          releaseDate: snapshot.releaseDate,
          albumType: snapshot.albumType,
          totalDiscs: snapshot.totalDiscs,
          labels: snapshot.labels,
          artists: snapshot.artists
        }
      : pending.album
    pending.resolve({ proceed: false, album: reverted })
    setPending(null)
  }

  let dialog: React.JSX.Element | null = null
  if (pending?.kind === 'dedupe') {
    dialog = (
      <div className="modal-safe-area fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
        <div className="bg-neutral-900 border border-white/10 rounded-lg w-[420px] p-4 flex flex-col gap-3">
          <div className="text-sm">
            检测到 {pending.candidates.length} 张同名专辑《{pending.album.title.trim()}》，请选择其中一张，或直接新建一张同名专辑：
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {pending.candidates.map((c) => (
              <div
                key={c.id}
                onClick={() => handlePickCandidate(c)}
                className="px-2 py-1.5 text-sm rounded hover:bg-white/10 cursor-default flex justify-between gap-2"
              >
                <span className="truncate">{c.artistNames || '未知艺术家'}</span>
                <span className="text-neutral-500 text-xs flex-shrink-0">{c.release_date ?? '--'}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={handleCreateNew} className="text-sm px-3 py-1.5 rounded hover:bg-white/10 text-neutral-400">
              直接新建
            </button>
          </div>
        </div>
      </div>
    )
  } else if (pending?.kind === 'change') {
    dialog = (
      <div className="modal-safe-area fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
        <div className="bg-neutral-900 border border-white/10 rounded-lg w-[380px] p-4 flex flex-col gap-3">
          <div className="text-sm">
            检测到专辑《{pending.album.title.trim()}》的信息被修改。该专辑可能被多首歌共用，是否将这些改动应用到专辑本身？
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={handleRevertChange} className="text-sm px-3 py-1.5 rounded hover:bg-white/10 text-neutral-400">
              不应用，还原
            </button>
            <button onClick={handleApplyChange} className="text-sm px-3 py-1.5 rounded bg-white/20 hover:bg-white/30">
              应用改动
            </button>
          </div>
        </div>
      </div>
    )
  }

  return { check, dialog }
}
