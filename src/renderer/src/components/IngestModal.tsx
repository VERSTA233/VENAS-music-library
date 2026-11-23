import { useEffect, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import type { AppendEntry } from '../../../shared/types'
import SongForm, { songFormMetadata, type SongFormValue } from './SongForm'
import { useAlbumSubmitGuard } from './AlbumSubmitGuard'
import { useArtistSubmitGuard } from './ArtistSubmitGuard'
import { usePlayerStore, type PlayerTrack } from '../stores/playerStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useNavStore, type NavTarget } from '../stores/navStore'

interface IngestModalProps {
  entry: AppendEntry
  onClose: () => void
  onIngested: () => void
  onPreviewDetail?: () => void
}

/* Append 条目的入库表单：用户二次订正曲名/艺术家/文件名/Tag，确认后移动文件并写库 */
export default function IngestModal({ entry, onClose, onIngested, onPreviewDetail }: IngestModalProps): React.JSX.Element {
  const [previewingDetail, setPreviewingDetail] = useState(false)
  const { returnTo, restoreSignal } = useNavStore()
  const [targetFileName, setTargetFileName] = useState(entry.fileName)
  const [form, setForm] = useState<SongFormValue>({
    title: entry.title,
    firstHeardDate: '',
    lyric: entry.lyric ?? '',
    /* 记录当前歌词来自哪个源文件的绝对路径，入库成功后据此删除该文件；手动编辑歌词内容后仍保留，改字后依然会删除源文件 */
    lyricFilePath: entry.lyricFilePath,
    artists: [],
    tags: [],
    album: {
      title: entry.album ?? '',
      releaseDate: entry.releaseDate ?? '',
      albumType: 'Album',
      totalDiscs: entry.totalDiscs != null ? String(entry.totalDiscs) : '',
      labels: entry.labels ?? (entry.label ? [entry.label] : []),
      discNumber: entry.discNumber != null ? String(entry.discNumber) : '',
      trackNumber: entry.trackNumber != null ? String(entry.trackNumber) : '',
      /* 专辑艺术家自动从 albumartist 字段识别，支持多艺术家（同艺术家字段一样用 / 分隔） */
      artists: entry.albumArtist
        ? entry.albumArtist
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name, i) => ({ name, role: 'Primary', order: i, type: 'Person' as const }))
        : [],
      // 入库时尚未经过用户显式选定，即便标题自动预填出了同名专辑，也要先走红/黄/绿灯判定
      selectedAlbumId: null,
      selectedAlbumSnapshot: null
    },
    score: '',
    comment: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coverWarning, setCoverWarning] = useState(false)
  const albumGuard = useAlbumSubmitGuard()
  const artistGuard = useArtistSubmitGuard()
  const hasTrack = usePlayerStore((s) => s.currentIndex !== null)

  useEffect(() => {
    if (!previewingDetail) return
    if (restoreSignal?.view === 'append') setPreviewingDetail(false)
    else if (returnTo?.view !== 'append') onClose()
  }, [previewingDetail, returnTo, restoreSignal, onClose])

  function previewDetail(target: Extract<NavTarget, { view: 'artist' | 'album' | 'tag' }>): void {
    setPreviewingDetail(true)
    onPreviewDetail?.()
    useNavStore.getState().navigate(target, { view: 'append' })
  }

  useEffect(() => {
    window.api.append.parseArtists(entry.artist, entry.title).then((res) => {
      const parsedArtists = res.artists.map((a) => ({ ...a, type: 'Person' as const }))
      setForm((prev) => ({
        ...prev,
        artists: parsedArtists,
        title: res.cleanedTitle || prev.title,
        /*
         * 专辑艺术家 Tag 缺失时，先用歌曲艺术家兜底填入专辑艺术家；
         * 一旦用户从建议列表中选中已有专辑，AlbumPicker 的 applyAlbumCandidate 会用该专辑自身的艺术家整体覆盖这里的兜底值，无需在此处理已匹配到专辑的情况
         */
        album: entry.albumArtist
          ? prev.album
          : { ...prev.album, artists: parsedArtists.map((a, i) => ({ ...a, role: 'Primary', order: i })) }
      }))
    })
  }, [entry])

  async function handleIngest(): Promise<void> {
    if (!form.title.trim() || !targetFileName.trim()) return
    if (/[/\\]/.test(targetFileName.trim())) {
      setError('文件名不能包含 / 或 \\')
      return
    }

    /* 新增项与已有艺术家同名时，先让用户决定返回选择还是保存为新艺术家 */
    const artistsToCheck = form.album.title.trim() ? [...form.artists, ...form.album.artists] : form.artists
    if (!(await artistGuard.check(artistsToCheck))) return

    // 专辑黄灯（同名未选定）/绿灯脏改动需要用户先在弹框中确认，确认结果会回填到 form.album
    const guardResult = await albumGuard.check(form.album)
    if (!guardResult.proceed) {
      setForm((prev) => ({ ...prev, album: guardResult.album }))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.api.append.ingest({
        ...songFormMetadata(form, guardResult.album),
        fileName: entry.fileName,
        targetFileName: targetFileName.trim(),
        tags: form.tags.map((t) => ({ id: t.id }))
      })
      const storedSong = await window.api.songs.detail(result.songId)
      const promotedTrack: PlayerTrack = storedSong
        ? {
            key: `music-${storedSong.id}`,
            title: storedSong.title,
            artistNames: storedSong.artists.map((artist) => artist.name).join(' / ') || '未知艺术家',
            mediaUrl: window.api.songs.mediaUrl(storedSong.file_name),
            songId: storedSong.id,
            appendEntry: null
          }
        : {
            key: `music-${result.songId}`,
            title: form.title.trim(),
            artistNames: form.artists.map((artist) => artist.name).join(' / ') || '未知艺术家',
            mediaUrl: window.api.songs.mediaUrl(targetFileName.trim()),
            songId: result.songId,
            appendEntry: null
          }
      usePlayerStore.getState().promoteAppendTrack(entry.fileName, promotedTrack)
      useLibraryStore.getState().invalidateSongs()
      if (result.coverCacheFailed) {
        setCoverWarning(true)
        return
      }
      onIngested()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    setError(null)
    try {
      await window.api.append.delete(entry.fileName)
      usePlayerStore.getState().removeAppendTrack(entry.fileName)
      onIngested()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  function handleClose(): void {
    if (coverWarning) onIngested()
    else onClose()
  }

  return (
    <div className={`modal-safe-area fixed inset-0 z-[80] ${previewingDetail ? 'hidden' : 'flex'} items-center justify-center bg-black/70 p-4 backdrop-blur-sm${hasTrack ? ' pb-[92px]' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ingest-modal-title">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur-2xl ${hasTrack ? 'max-h-[calc(100dvh-140px)]' : 'max-h-[calc(100dvh-4rem)]'}`}
      >
        <div className="window-drag-region flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <h2 id="ingest-modal-title" className="text-base font-semibold text-white">添加到音乐库</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting || deleting || coverWarning}
              className="library-icon-button text-neutral-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
              title="删除 Append 音频"
              aria-label="删除 Append 音频"
            >
              <Trash2 size={16} />
            </button>
            <button type="button" onClick={handleClose} disabled={submitting || deleting} className="library-icon-button modal-close-button disabled:cursor-not-allowed disabled:opacity-30" title="关闭" aria-label="关闭">
              <X size={18} />
            </button>
            <button
              type="button"
              onClick={coverWarning ? onIngested : handleIngest}
              disabled={submitting || deleting || (!coverWarning && (!form.title.trim() || !targetFileName.trim()))}
              className="library-icon-button modal-confirm-button disabled:cursor-not-allowed disabled:opacity-30"
              title={coverWarning ? '完成' : submitting ? '入库中...' : '确认入库'}
              aria-label={coverWarning ? '完成' : submitting ? '入库中...' : '确认入库'}
            >
              <Check size={19} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="modal-scroll mb-2.5 min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500">文件名</label>
              <input
                value={targetFileName}
                onChange={(e) => setTargetFileName(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
              />
            </div>

            <SongForm
              value={form}
              onChange={setForm}
              onOpenArtist={(id) => previewDetail({ view: 'artist', id, isLabel: false })}
              onOpenAlbum={(id) => previewDetail({ view: 'album', id })}
              onOpenTag={(tag) => previewDetail({ view: 'tag', id: tag.id, parentType: tag.tag_type ?? undefined })}
            />

            {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{error}</div>}
            {coverWarning && (
              <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                歌曲已入库成功，但封面缓存写入失败，Music 列表将显示占位图。可稍后通过"重载音频文件"重试或手动上传封面。
              </div>
            )}
          </div>
        </div>
      </div>
      {albumGuard.dialog}
      {artistGuard.dialog}
    </div>
  )
}
