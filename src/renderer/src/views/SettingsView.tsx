import { useEffect, useState } from 'react'
import { Database, FolderCog, HardDrive, Image, Music2, ScanSearch, Terminal } from 'lucide-react'
import type { MusicRootInspection } from '../../../shared/types'

interface Roots {
  musicRoot: string
  systemRoot: string
  neteaseMusicRoot: string | null
}

export default function SettingsView(): React.JSX.Element {
  const [roots, setRoots] = useState<Roots | null>(null)
  const [openingDatabase, setOpeningDatabase] = useState(false)
  const [selectingMusicRoot, setSelectingMusicRoot] = useState(false)
  const [musicRootInspection, setMusicRootInspection] = useState<MusicRootInspection | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<{ title: string; entries: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.library.getRoots().then(setRoots)
  }, [])

  async function openDatabaseTerminal(): Promise<void> {
    setOpeningDatabase(true)
    setError(null)
    try {
      await window.api.library.openDatabaseTerminal()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setOpeningDatabase(false)
    }
  }

  async function pickMusicRoot(): Promise<void> {
    setSelectingMusicRoot(true)
    setError(null)
    try {
      const inspection = await window.api.library.pickMusicRoot()
      if (inspection) setMusicRootInspection(inspection)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSelectingMusicRoot(false)
    }
  }

  async function pickNeteaseMusicRoot(): Promise<void> {
    setError(null)
    try {
      const neteaseMusicRoot = await window.api.library.changeNeteaseMusicRoot()
      if (neteaseMusicRoot) setRoots((current) => current ? { ...current, neteaseMusicRoot } : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function runCheck(kind: 'audio' | 'cover' | 'picture'): Promise<void> {
    setChecking(kind)
    setError(null)
    try {
      if (kind === 'audio') {
        const files = await window.api.library.checkMissingAudio()
        setCheckResult({ title: '缺失的音频文件', entries: files.map((file) => `${file.title}  (${file.fileName})`) })
      } else if (kind === 'cover') {
        const covers = await window.api.library.checkMissingCovers()
        setCheckResult({ title: '缺失的封面缩略图', entries: covers.map((cover) => `${cover.title}  (${cover.coverKind === 'album' ? `专辑封面 #${cover.coverId}` : `歌曲封面 #${cover.coverId}`})`) })
      } else {
        const pictures = await window.api.library.checkOrphanPictures()
        setCheckResult({
          title: '未关联的 assets 图片',
          entries: [
            ...pictures.artist.map((file) => `艺术家：${file}`),
            ...pictures.song.map((file) => `歌曲：${file}`),
            ...pictures.album.map((file) => `专辑：${file}`)
          ]
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChecking(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="library-toolbar sticky top-0 z-10 border-b border-white/[0.08]">
        <h1 className="text-xl font-semibold leading-tight">Setting</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-7">
        <div className="w-full space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">存储位置</h2>
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
              <SettingRow icon={<FolderCog size={19} />} title="音乐目录" description={roots?.musicRoot ?? '加载中...'} action={selectingMusicRoot ? '正在扫描...' : '更改目录'} onClick={pickMusicRoot} disabled={selectingMusicRoot} />
              <div className="mx-5 border-t border-white/[0.08]" />
              <SettingRow icon={<HardDrive size={19} />} title="系统目录" description={roots?.systemRoot ?? '加载中...'} action="更改目录" onClick={() => window.api.library.changeSystemRoot()} />
              <div className="mx-5 border-t border-white/[0.08]" />
              <SettingRow icon={<Music2 size={19} />} title="网易云音乐目录" description={roots?.neteaseMusicRoot ?? '尚未选择'} action="选择目录" onClick={pickNeteaseMusicRoot} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">数据库</h2>
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
              <SettingRow
                icon={<Database size={19} />}
                title="音乐数据库"
                description={roots ? `${roots.systemRoot}/.system/database/music.db` : '加载中...'}
                action={openingDatabase ? '正在打开...' : '打开终端'}
                actionIcon={<Terminal size={16} />}
                onClick={openDatabaseTerminal}
                disabled={openingDatabase || !roots}
              />
            </div>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">音乐库检查</h2>
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
              <SettingRow icon={<Music2 size={19} />} title="音频文件关联" description="检查数据库中的歌曲音频是否仍在 Music 文件夹" action={checking === 'audio' ? '检查中...' : '检查'} onClick={() => runCheck('audio')} disabled={checking != null} />
              <div className="mx-5 border-t border-white/[0.08]" />
              <SettingRow icon={<Image size={19} />} title="封面缩略图" description="检查播放器实际使用的歌曲或专辑封面是否缺失" action={checking === 'cover' ? '检查中...' : '检查'} onClick={() => runCheck('cover')} disabled={checking != null} />
              <div className="mx-5 border-t border-white/[0.08]" />
              <SettingRow icon={<ScanSearch size={19} />} title="未关联图片" description="检查 assets 中没有对应艺术家、歌曲或专辑记录的图片" action={checking === 'picture' ? '检查中...' : '检查'} onClick={() => runCheck('picture')} disabled={checking != null} />
            </div>
            {checkResult && <CheckResult result={checkResult} onClose={() => setCheckResult(null)} />}
          </section>
        </div>
      </div>
      {musicRootInspection && (
        <MusicRootChangeDialog
          inspection={musicRootInspection}
          onCancel={() => setMusicRootInspection(null)}
          onConfirm={() => window.api.library.confirmMusicRootChange(musicRootInspection.musicRoot)}
        />
      )}
    </div>
  )
}

function CheckResult({ result, onClose }: { result: { title: string; entries: string[] }; onClose: () => void }): React.JSX.Element {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3"><span className="text-sm font-medium text-neutral-200">{result.title}</span><button type="button" onClick={onClose} className="text-xs text-neutral-500 transition hover:text-white">关闭</button></div>
      {result.entries.length === 0 ? (
        <p className="px-4 py-4 text-sm text-neutral-500">未发现问题</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto px-4 py-3 text-xs leading-6 text-neutral-400">
          {result.entries.map((entry) => <li key={entry} className="break-all">{entry}</li>)}
        </ul>
      )}
    </div>
  )
}

function MusicRootChangeDialog({ inspection, onCancel, onConfirm }: { inspection: MusicRootInspection; onCancel: () => void; onConfirm: () => Promise<boolean> }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const missingCount = inspection.missingFiles.length

  async function handleConfirm(): Promise<void> {
    setConfirming(true)
    try {
      await onConfirm()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="modal-safe-area fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="music-root-change-title">
      <div className="flex max-h-[min(680px,calc(100vh-40px))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#1a1a1e] shadow-2xl">
        <div className="border-b border-white/[0.08] px-6 py-5">
          <h2 id="music-root-change-title" className="text-base font-semibold text-white">确认更改音乐目录</h2>
          <p className="mt-1 text-sm text-neutral-400">已扫描 {inspection.totalSongs} 首已入库歌曲。此操作不会复制、移动或删除任何文件。</p>
          <p className="mt-3 break-all text-xs text-neutral-500">目标目录：{inspection.musicRoot}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {missingCount === 0 ? (
            <p className="text-sm text-neutral-300">目标目录中已找到全部已入库音频文件。</p>
          ) : (
            <>
              <p className="text-sm leading-6 text-amber-200">有 {missingCount} 首已入库歌曲不在目标目录的 Music 文件夹中。切换后，它们将暂时无法播放。</p>
              <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-lg bg-black/20 p-3 text-xs text-neutral-400">
                {inspection.missingFiles.map((fileName) => <li key={fileName} className="break-all">{fileName}</li>)}
              </ul>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-white/[0.08] px-6 py-4">
          <button type="button" onClick={onCancel} disabled={confirming} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40">取消</button>
          <button type="button" onClick={handleConfirm} disabled={confirming} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-40">{confirming ? '正在切换...' : missingCount > 0 ? '仍然切换' : '确认切换'}</button>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ icon, title, description, action, actionIcon, onClick, disabled = false }: { icon: React.ReactNode; title: string; description: string; action: string; actionIcon?: React.ReactNode; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-h-22 items-center gap-4 px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-neutral-300">{icon}</div>
      <div className="min-w-0 flex-1"><div className="text-sm font-medium text-neutral-100">{title}</div><div className="mt-1 truncate text-xs text-neutral-500" title={description}>{description}</div></div>
      <button type="button" onClick={onClick} disabled={disabled} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.1] px-3 py-2 text-xs font-medium text-neutral-200 transition hover:bg-white/[0.17] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">{actionIcon}{action}</button>
    </div>
  )
}
