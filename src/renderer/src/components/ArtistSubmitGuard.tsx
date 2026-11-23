import { useState } from 'react'
import type { ArtistRow } from '../../../shared/types'
import type { ArtistFormEntry } from './ArtistPicker'

interface PendingMatch {
  name: string
  candidates: ArtistRow[]
}

/*
 * 黄灯艺术家的提交前拦截：明确新增或行内改名后仍为新增，且数据库中已有同名艺术家时，
 * 弹框询问是返回选择还是直接保存为新艺术家。check() 返回 true 表示继续提交。
 */
export function useArtistSubmitGuard(): { check: (artists: ArtistFormEntry[]) => Promise<boolean>; dialog: React.JSX.Element | null } {
  const [pending, setPending] = useState<{ matches: PendingMatch[]; resolve: (proceed: boolean) => void } | null>(null)

  async function check(artists: ArtistFormEntry[]): Promise<boolean> {
    const names = Array.from(new Set(artists.filter((a) => a.createNew).map((a) => a.name.trim()).filter(Boolean)))
    /* 查询失败时不拦截，保存流程照旧。 */
    const results = await Promise.all(names.map((name) => window.api.artists.findExact(name).catch(() => null)))
    const matches = names.flatMap((name, i) => results[i] ? [{ name, candidates: [results[i]] }] : [])
    if (matches.length === 0) return true
    return new Promise<boolean>((resolve) => setPending({ matches, resolve }))
  }

  function finish(proceed: boolean): void {
    pending?.resolve(proceed)
    setPending(null)
  }

  const dialog = pending && (
    <div className="modal-safe-area fixed inset-0 bg-black/60 flex items-center justify-center z-[90]">
      <div className="bg-neutral-900 border border-white/10 rounded-lg w-[420px] p-4 flex flex-col gap-3">
        <div className="text-sm">以下新增艺术家与已有艺术家同名。可返回修改或移除重复项；直接保存将创建独立的新艺术家。</div>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {pending.matches.map((match) => (
            <div key={match.name} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-yellow-500" />
                <span className="truncate">{match.name}</span>
              </div>
              <div className="pl-4 text-xs text-neutral-500 truncate">
                已有：{match.candidates.map((c) => `${c.name} #${c.id}`).join('、')}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => finish(true)} className="text-sm px-3 py-1.5 rounded hover:bg-white/10 text-neutral-400">
            直接保存
          </button>
          <button onClick={() => finish(false)} className="text-sm px-3 py-1.5 rounded bg-white/20 hover:bg-white/30">
            返回修改
          </button>
        </div>
      </div>
    </div>
  )

  return { check, dialog }
}
