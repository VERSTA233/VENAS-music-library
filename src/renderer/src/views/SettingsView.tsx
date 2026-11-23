import { useEffect, useState } from 'react'
import { FolderCog, HardDrive, Music2 } from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'
import type { MusicRootInspection } from '../../../shared/types'
import AudioOutputSettings from '../components/AudioOutputSettings'
import SettingRow from '../components/SettingRow'
import SettingsPage from '../components/SettingsPage'

interface Roots {
  musicRoot: string
  systemRoot: string
  neteaseMusicRoot: string | null
}

export default function SettingsView(): React.JSX.Element {
  const gaplessEnabled = usePlayerStore((state) => state.gaplessEnabled)
  const gaplessReady = usePlayerStore((state) => state.gaplessReady)
  const [savingPlayback, setSavingPlayback] = useState(false)
  const [roots, setRoots] = useState<Roots | null>(null)
  const [selectingMusicRoot, setSelectingMusicRoot] = useState(false)
  const [changingSystemRoot, setChangingSystemRoot] = useState(false)
  const [musicRootInspection, setMusicRootInspection] = useState<MusicRootInspection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.library.getRoots().then(setRoots).catch(reason => setError(String(reason)))
  }, [])

  async function changeGapless(enabled: boolean): Promise<void> {
    setSavingPlayback(true)
    setError(null)
    try {
      await window.api.playback.setGapless(enabled)
      usePlayerStore.getState().setGaplessEnabled(enabled)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSavingPlayback(false)
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

  async function changeSystemRoot(): Promise<void> {
    setChangingSystemRoot(true)
    setError(null)
    try {
      await window.api.library.changeSystemRoot()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChangingSystemRoot(false)
    }
  }

  return (
    <>
      <SettingsPage title="Settings">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">播放</h2>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035]">
            <label className="flex cursor-pointer items-center justify-between gap-6 px-5 py-4">
              <span>
                <span className="block text-sm text-neutral-200">无缝播放</span>
                <span id="gapless-description" className="mt-1 block text-xs text-neutral-500">提前准备下一首，连续衔接播放。不支持或过大的文件自动使用普通播放。</span>
              </span>
              <span className="relative inline-flex shrink-0">
                <input type="checkbox" role="switch" aria-label="无缝播放" aria-describedby="gapless-description" checked={gaplessEnabled} disabled={!gaplessReady || savingPlayback} onChange={(event) => void changeGapless(event.target.checked)} onKeyDown={(event) => { if (event.code === 'Space') event.stopPropagation() }} className="peer sr-only" />
                <span aria-hidden="true" className="h-6 w-11 rounded-full bg-neutral-700 p-0.5 transition-colors duration-200 after:block after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-white/80 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-neutral-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-40 motion-reduce:transition-none motion-reduce:after:transition-none" />
              </span>
            </label>
            <AudioOutputSettings />
          </div>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">存储位置</h2>
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
            <SettingRow icon={<FolderCog size={19} />} title="音乐目录" description={roots?.musicRoot ?? '加载中...'} action={selectingMusicRoot ? '正在扫描...' : '更改目录'} onClick={pickMusicRoot} disabled={selectingMusicRoot} />
            <div className="mx-5 border-t border-white/[0.08]" />
            <SettingRow icon={<HardDrive size={19} />} title="系统目录" description={roots?.systemRoot ?? '加载中...'} action={changingSystemRoot ? '正在迁移...' : '更改目录'} onClick={changeSystemRoot} disabled={changingSystemRoot} />
            <div className="mx-5 border-t border-white/[0.08]" />
            <SettingRow icon={<Music2 size={19} />} title="网易云音乐目录" description={roots?.neteaseMusicRoot ?? '尚未选择'} action="选择目录" onClick={pickNeteaseMusicRoot} />
          </div>
        </section>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      </SettingsPage>
      {musicRootInspection && (
        <MusicRootChangeDialog
          inspection={musicRootInspection}
          onCancel={() => setMusicRootInspection(null)}
          onConfirm={() => window.api.library.confirmMusicRootChange(musicRootInspection.musicRoot)}
        />
      )}
    </>
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
      <div className="flex max-h-[min(680px,calc(100vh-40px))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-dialog shadow-2xl">
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
