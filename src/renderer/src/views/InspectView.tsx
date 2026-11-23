import { useEffect, useState } from 'react'
import { Copy, Database, Disc3, Image, Music2, ScanSearch, Terminal, Users } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import SettingRow from '../components/SettingRow'
import SettingsPage from '../components/SettingsPage'
import AudioIntegritySettings from '../components/AudioIntegritySettings'

interface LibraryCheckResult {
  title: string
  entries: string[]
  cleanup?: { kind: 'album' | 'artist'; ids: number[] }
}

export default function InspectView(): React.JSX.Element {
  const [roots, setRoots] = useState<{systemRoot: string} | null>(null)
  const [openingDatabase, setOpeningDatabase] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<LibraryCheckResult | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { window.api.library.getRoots().then(setRoots).catch(reason => setError(String(reason))) }, [])

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

  async function runCheck(kind: 'audio' | 'cover' | 'picture' | 'album' | 'artist' | 'duplicate'): Promise<void> {
    setChecking(kind)
    setError(null)
    setCleanupMessage(null)
    try {
      if (kind === 'audio') {
        const files = await window.api.library.checkMissingAudio()
        setCheckResult({ title: '缺失的音频文件', entries: files.map((file) => `${file.title}  (${file.fileName})`) })
      } else if (kind === 'cover') {
        const covers = await window.api.library.checkMissingCovers()
        setCheckResult({ title: '仍缺失的封面缩略图（已自动重建可恢复项）', entries: covers.map((cover) => `${cover.title}  (${cover.coverKind === 'album' ? `专辑封面 #${cover.coverId}` : `歌曲封面 #${cover.coverId}`})`) })
      } else if (kind === 'picture') {
        const pictures = await window.api.library.checkOrphanPictures()
        setCheckResult({
          title: '未关联图片',
          entries: [
            ...pictures.artist.map((file) => `艺术家：${file}`),
            ...pictures.song.map((file) => `歌曲：${file}`),
            ...pictures.album.map((file) => `专辑：${file}`)
          ]
        })
      } else if (kind === 'album') {
        const albums = await window.api.library.checkAlbumsWithoutSongs()
        setCheckResult({ title: '无歌曲专辑', entries: albums.map((album) => `${album.title}  (专辑 #${album.albumId})`), cleanup: { kind: 'album', ids: albums.map((album) => album.albumId) } })
      } else if (kind === 'artist') {
        const artists = await window.api.library.checkArtistsWithoutSongs()
        setCheckResult({
          title: '无歌曲艺术家 / 厂牌',
          entries: artists.map((artist) => `${artist.type === 'Label' ? '厂牌' : '艺术家'}：${artist.name}  (#${artist.artistId}${artist.type ? ` · ${artist.type}` : ''})`),
          cleanup: { kind: 'artist', ids: artists.map((artist) => artist.artistId) }
        })
      } else {
        const groups = await window.api.library.checkDuplicateArtistNames()
        setCheckResult({
          title: '重名艺术家 / 厂牌',
          entries: groups.map((group) => `“${group.name}”：${group.records.map((record) => `${record.type === 'Label' ? '厂牌' : '艺术家'} #${record.artistId}${record.type ? ` (${record.type})` : ''}`).join(' / ')}`)
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChecking(null)
    }
  }

  async function cleanCheckResult(): Promise<void> {
    if (!checkResult?.cleanup || checking || cleaning) return
    const { kind, ids } = checkResult.cleanup
    setCleaning(true)
    setError(null)
    try {
      const result = kind === 'album'
        ? await window.api.library.cleanAlbumsWithoutSongs(ids)
        : await window.api.library.cleanArtistsWithoutSongs(ids)
      useLibraryStore.getState().invalidateSongs()
      await runCheck(kind)
      setCleanupMessage(`已清理 ${result.deletedIds.length} 项${result.skippedIds.length ? `，跳过 ${result.skippedIds.length} 项（已关联歌曲或已不存在）` : ''}。${result.warnings.join('；')}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCleaning(false)
    }
  }

  return <SettingsPage title="Inspect">
    <section>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">音乐库检查</h2>
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035]">
        <SettingRow icon={<Music2 size={19} />} title="音频文件关联" description="检查数据库中的歌曲音频是否仍在 Music 文件夹" action={checking === 'audio' ? '检查中...' : '检查'} onClick={() => runCheck('audio')} disabled={checking != null || cleaning} />
        <div className="mx-5 border-t border-white/[0.08]" />
        <SettingRow icon={<Image size={19} />} title="封面缩略图" description="检查并从音频内嵌封面自动重建缺失缓存" action={checking === 'cover' ? '检查中...' : '检查并修复'} onClick={() => runCheck('cover')} disabled={checking != null || cleaning} />
        <div className="mx-5 border-t border-white/[0.08]" />
        <SettingRow icon={<ScanSearch size={19} />} title="未关联图片" description="检查 assets 中没有对应艺术家、歌曲或专辑记录的图片" action={checking === 'picture' ? '检查中...' : '检查'} onClick={() => runCheck('picture')} disabled={checking != null || cleaning} />
        <div className="mx-5 border-t border-white/[0.08]" />
        <SettingRow icon={<Disc3 size={19} />} title="无歌曲专辑" description="检查数据库中没有关联任何歌曲的专辑" action={checking === 'album' ? '检查中...' : '检查'} onClick={() => runCheck('album')} disabled={checking != null || cleaning} />
        <div className="mx-5 border-t border-white/[0.08]" />
        <SettingRow icon={<Users size={19} />} title="无歌曲艺术家 / 厂牌" description="检查没有直接或专辑曲目关联的艺术家与厂牌" action={checking === 'artist' ? '检查中...' : '检查'} onClick={() => runCheck('artist')} disabled={checking != null || cleaning} />
        <div className="mx-5 border-t border-white/[0.08]" />
        <SettingRow icon={<Copy size={19} />} title="重名艺术家 / 厂牌" description="检查忽略前后空格及大小写后的同名记录" action={checking === 'duplicate' ? '检查中...' : '检查'} onClick={() => runCheck('duplicate')} disabled={checking != null || cleaning} />
      </div>
      {checkResult && <CheckResult key={checkResult.title} result={checkResult} busy={cleaning || checking != null} onClean={cleanCheckResult} onClose={() => { setCheckResult(null); setCleanupMessage(null) }} />}
      {cleanupMessage && <p role="status" className="mt-3 text-xs text-neutral-400">{cleanupMessage}</p>}
    </section>
    <AudioIntegritySettings />
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
    </section>

    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </SettingsPage>
}

function CheckResult({ result, busy, onClean, onClose }: { result: LibraryCheckResult; busy: boolean; onClean: () => Promise<void>; onClose: () => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-white/[0.08] px-4">
        <span className="min-w-0 truncate text-sm font-medium text-neutral-200" title={result.title}>{result.title}</span>
        <div className="flex shrink-0 items-center gap-3">
          {result.cleanup && <button type="button" disabled={busy || result.entries.length === 0} onClick={() => setConfirming(true)} className="inline-flex h-7 items-center justify-center rounded-lg bg-red-500/10 px-3 text-xs text-red-400 transition hover:bg-red-500/20 disabled:opacity-40">{busy && confirming ? '清理中...' : '清理'}</button>}
          <button type="button" disabled={busy} onClick={onClose} className="inline-flex h-7 items-center justify-center text-xs text-neutral-500 transition hover:text-white disabled:opacity-40">关闭</button>
        </div>
      </div>
      {confirming && result.cleanup && result.entries.length > 0 && (
        <div className="border-b border-white/[0.08] px-4 py-3">
          <p className="text-xs leading-5 text-red-300">
            删除列表中的 {result.entries.length} 项及对应缓存图片？
            {result.cleanup.kind === 'artist' ? '相关的专辑、别名和团队成员关联也会解除。' : '相关的专辑艺术家和厂牌关联也会解除。'}
            音频文件保留。
          </p>
          <div className="mt-2 flex justify-end gap-3">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="px-3 py-1.5 text-xs text-neutral-400 disabled:opacity-40">取消</button>
            <button type="button" disabled={busy} onClick={() => void onClean().finally(() => setConfirming(false))} className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/30 disabled:opacity-40">确认清理</button>
          </div>
        </div>
      )}
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
