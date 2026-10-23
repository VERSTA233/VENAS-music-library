import { useEffect, useState } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import type { ReloadFileSelection, SongDetail } from '../../../shared/types'
import SongForm, { type SongFormValue } from './SongForm'
import ReloadAudioPanel from './ReloadAudioPanel'
import { useAlbumSubmitGuard } from './AlbumSubmitGuard'
import { useNavStore, type NavTarget, type ReturnContext } from '../stores/navStore'
import { usePlayerStore } from '../stores/playerStore'
import { useLibraryStore } from '../stores/libraryStore'

interface SongEditModalProps {
  songId: number
  onClose: () => void
  onSaved: () => void
  /* 调用方（如 MusicView）传入时，点击艺术家/专辑/厂牌链接跳转后可以从详情页原样返回这里 */
  returnContext?: ReturnContext
}

const EMPTY_FORM: SongFormValue = {
  title: '',
  firstHeardDate: '',
  lyric: '',
  lyricFilePath: null,
  artists: [],
  tags: [],
  album: {
    title: '',
    releaseDate: '',
    albumType: 'Album',
    totalDiscs: '',
    labels: [],
    discNumber: '',
    trackNumber: '',
    artists: [],
    selectedAlbumId: null,
    selectedAlbumSnapshot: null
  },
  score: '',
  comment: ''
}

function detailToFormValue(d: SongDetail): SongFormValue {
  const album = d.album
  return {
    title: d.title,
    firstHeardDate: d.first_heard_date ?? '',
    lyric: d.lyric ?? '',
    lyricFilePath: null,
    artists: d.artists.map((a) => ({ name: a.name, role: a.role, order: a.order, type: null })),
    tags: d.tags.map((t) => ({ id: t.id, name: t.name, tag_type: t.tag_type, description: null })),
    album: album
      ? (() => {
          const releaseDate = album.release_date ?? ''
          const albumType = album.album_type ?? 'Album'
          const totalDiscs = album.total_discs != null ? String(album.total_discs) : ''
          const labels = album.labels.map((label) => label.name)
          const artists = album.artists.map((a) => ({ name: a.name, role: 'Primary', order: a.order, type: null }))
          return {
            title: album.title,
            releaseDate,
            albumType,
            totalDiscs,
            labels,
            discNumber: album.disc_number != null ? String(album.disc_number) : '',
            trackNumber: album.track_number != null ? String(album.track_number) : '',
            artists,
            // 歌曲本来就关联着这张专辑，视为隐式已选定（绿灯），编辑其字段同样受改动确认框保护
            selectedAlbumId: album.id,
            selectedAlbumSnapshot: { releaseDate, albumType, totalDiscs, labels, artists }
          }
        })()
      : EMPTY_FORM.album,
    score: d.score != null ? String(d.score) : '',
    comment: d.comment ?? ''
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--'
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

/*
 * Music 列表"..."按钮触发的歌曲信息弹窗：默认只读展示歌曲与所属专辑信息，
 * 点击"编辑"按钮才切换为可编辑表单（与"添加到音乐库"共用 SongForm），避免误触修改。
 */
export default function SongEditModal({
  songId,
  onClose,
  onSaved,
  returnContext
}: SongEditModalProps): React.JSX.Element {
  const [detail, setDetail] = useState<SongDetail | null>(null)
  const [editing, setEditing] = useState(false)

  const [form, setForm] = useState<SongFormValue>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [showReload, setShowReload] = useState(false)
  const [fileName, setFileName] = useState('')
  const [replacementFile, setReplacementFile] = useState<ReloadFileSelection | null>(null)
  const [confirmingDeletion, setConfirmingDeletion] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { navigate } = useNavStore()
  const albumGuard = useAlbumSubmitGuard()
  const hasTrack = usePlayerStore((s) => s.currentIndex !== null)

  useEffect(() => {
    window.api.songs.detail(songId).then((d) => {
      if (!d) return
      setDetail(d)
      setForm(detailToFormValue(d))
      setFileName(d.file_name)
    })
  }, [songId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      /* 捕获阶段先处理，避免全屏播放器把 ESC 当作关闭播放器。 */
      event.preventDefault()
      event.stopPropagation()
      if (confirmingDeletion) {
        setConfirmingDeletion(false)
        return
      }
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [confirmingDeletion, onClose])

  function startEditing(): void {
    if (detail) setForm(detailToFormValue(detail)) // 从最新数据重新填表，避免残留上次未保存的编辑
    if (detail) setFileName(detail.file_name)
    setReplacementFile(null)
    setSaveError(null)
    setEditing(true)
  }

  function cancelEditing(): void {
    if (detail) setForm(detailToFormValue(detail)) // 丢弃改动
    if (detail) setFileName(detail.file_name)
    setEditing(false)
    setShowReload(false)
    setReplacementFile(null)
    setSaveError(null)
  }

  async function handleSave(): Promise<void> {
    if (!form.title.trim() || !fileName.trim()) return

    // 专辑黄灯（同名未选定）/绿灯脏改动需要用户先在弹框中确认，确认结果会回填到 form.album
    const guardResult = await albumGuard.check(form.album)
    if (!guardResult.proceed) {
      setForm((prev) => ({ ...prev, album: guardResult.album }))
      return
    }
    const album = guardResult.album

    setSaving(true)
    setSaveError(null)
    try {
      const result = await window.api.songs.update(songId, {
        title: form.title.trim(),
        fileName: fileName.trim(),
        replacementFilePath: replacementFile?.filePath ?? null,
        firstHeardDate: form.firstHeardDate.trim() || null,
        lyric: form.lyric.trim() || null,
        lyricFilePath: form.lyricFilePath,
        artists: form.artists,
        tagIds: form.tags.map((t) => t.id),
        album: album.title.trim()
          ? {
              title: album.title.trim(),
              releaseDate: album.releaseDate.trim() || null,
              albumType: album.albumType || null,
              totalDiscs: album.totalDiscs.trim() ? Number(album.totalDiscs) : null,
              labels: album.labels,
              discNumber: album.discNumber.trim() ? Number(album.discNumber) : null,
              trackNumber: album.trackNumber.trim() ? Number(album.trackNumber) : null,
              artists: album.artists,
              albumId: album.selectedAlbumId
            }
          : null,
        score: form.score.trim() ? Number(form.score) : null,
        comment: form.comment.trim() || null
      })
      usePlayerStore.getState().updateSongFile(songId, result.fileName, result.audioReplaced)
      useLibraryStore.getState().invalidateSongs()
      onSaved()
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    try {
      await window.api.songs.delete(songId)
      usePlayerStore.getState().removeSong(songId)
      useLibraryStore.getState().invalidateSongs()
      onSaved()
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  if (!detail) {
    return (
      <div className={`modal-safe-area fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm${hasTrack ? ' pb-[92px]' : ''}`}>
        <div className="text-neutral-400 text-sm">加载中...</div>
      </div>
    )
  }

  return (
    <div className={`modal-safe-area fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm${hasTrack ? ' pb-[92px]' : ''}`}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur-2xl ${hasTrack ? 'max-h-[calc(100dvh-140px)]' : 'max-h-[calc(100dvh-4rem)]'}`}
      >
        <div className="window-drag-region flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <h2 className="text-base font-semibold text-white">{editing ? '编辑歌曲信息' : '歌曲信息'}</h2>
          <div className="flex items-center gap-3">
            {!editing && (
              <button onClick={startEditing} className="library-icon-button" title="编辑歌曲信息" aria-label="编辑歌曲信息">
                <Pencil size={16} />
              </button>
            )}
            <button onClick={() => setConfirmingDeletion(true)} className="library-icon-button text-neutral-500 hover:text-red-300" title="删除歌曲" aria-label="删除歌曲">
              <Trash2 size={16} />
            </button>
            <button onClick={onClose} className="library-icon-button" title="关闭" aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {confirmingDeletion && (
          <div className="mb-5 rounded-lg border border-red-400/20 bg-red-400/[0.08] p-4">
            <p className="text-sm text-red-100">删除后将移除歌曲记录、Music 中的原始音频和歌曲封面，无法恢复。</p>
            <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setConfirmingDeletion(false)} disabled={deleting} className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-white/10">取消</button><button type="button" onClick={handleDelete} disabled={deleting} className="rounded bg-red-400 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40">{deleting ? '正在删除...' : '确认删除'}</button></div>
          </div>
        )}
        {editing ? (
          <>
            <SongForm value={form} onChange={setForm} />

            <div className="border-t border-white/10 pt-3">
              <button onClick={() => setShowReload((v) => !v)} className="text-xs text-neutral-400 hover:text-white">
                {showReload ? '收起 ▲' : '重载音频文件/封面 ▼'}
              </button>
              {showReload && (
                <ReloadAudioPanel
                  songId={songId}
                  currentFileName={detail.file_name}
                  targetFileName={fileName}
                  onTargetFileNameChange={setFileName}
                  selectedFile={replacementFile}
                  onSelectedFileChange={setReplacementFile}
                />
              )}
            </div>

            {saveError && <p className="rounded-lg bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">{saveError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={cancelEditing} className="text-sm px-3 py-1.5 rounded hover:bg-white/10 text-neutral-400">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim() || !fileName.trim()}
                className="text-sm px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <InfoRow label="歌名" value={detail.title} />
              <LinkedInfoRow
                label="艺术家"
                items={
                  detail.artists.length > 0
                    ? detail.artists.map((a) => ({ text: a.name, target: { view: 'artist', id: a.id, isLabel: false } as NavTarget }))
                    : []
                }
                emptyText="未知艺术家"
                suffixes={detail.artists.length > 0 ? detail.artists.map((a) => ` (${a.role})`) : []}
                onNavigate={(target) => {
                  navigate(target, returnContext)
                  onClose()
                }}
              />
              <InfoRow label="文件名" value={detail.file_name} />
              <div className="grid grid-cols-4 gap-x-6">
                <InfoRow label="时长" value={formatDuration(detail.length)} />
                <InfoRow label="评分" value={detail.score != null ? String(detail.score) : '--'} />
                <InfoRow label="歌词" value={detail.lyric ? '有' : '无'} />
                <div aria-hidden="true" />
              </div>
              <LinkedInfoRow
                label="Tags"
                items={detail.tags.map((t) => ({ text: t.name, target: { view: 'tag', id: t.id } as NavTarget }))}
                emptyText="--"
                onNavigate={(target) => {
                  navigate(target, returnContext)
                  onClose()
                }}
              />
            </div>

            <div className="mt-5 border-t border-white/[0.08] pt-4 flex flex-col gap-3">
              {detail.album ? (
                <>
                  <LinkedInfoRow
                    label="专辑名"
                    items={[{ text: detail.album.title, target: { view: 'album', id: detail.album.id } }]}
                    onNavigate={(target) => {
                      navigate(target, returnContext)
                      onClose()
                    }}
                  />
                  <LinkedInfoRow
                    label="专辑艺术家"
                    items={
                      detail.album.artists.length > 0
                        ? detail.album.artists.map((a) => ({ text: a.name, target: { view: 'artist', id: a.id, isLabel: false } as NavTarget }))
                        : []
                    }
                    emptyText="--"
                    onNavigate={(target) => {
                      navigate(target, returnContext)
                      onClose()
                    }}
                  />
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <InfoRow label="发行日期" value={detail.album.release_date ?? '--'} />
                    <InfoRow label="类型" value={detail.album.album_type ?? '--'} />
                    <InfoRow label="曲目号" value={detail.album.track_number != null ? String(detail.album.track_number) : '--'} />
                    <InfoRow
                      label="碟号 / 总碟数"
                      value={`${detail.album.disc_number ?? '--'} / ${detail.album.total_discs ?? '--'}`}
                    />
                  </div>
                  {detail.album.labels.length > 0 ? (
                    <LinkedInfoRow
                      label="厂牌"
                      items={detail.album.labels.map((label) => ({ text: label.name, target: { view: 'artist', id: label.id, isLabel: true } }))}
                      onNavigate={(target) => {
                        navigate(target, returnContext)
                        onClose()
                      }}
                    />
                  ) : (
                    <InfoRow label="厂牌" value="--" />
                  )}
                </>
              ) : (
                <div className="text-sm text-neutral-500">未加入任何专辑</div>
              )}
            </div>

            <div className="mt-5 border-t border-white/[0.08] pt-4 flex flex-col gap-3">
              <InfoRow label="添加时间" value={detail.add_time ?? '--'} />
              <div className="grid grid-cols-2 gap-x-6">
                <InfoRow label="初次聆听日期" value={detail.first_heard_date ?? '--'} />
                <InfoRow label="最近聆听日期" value={detail.last_heard_date ?? '--'} />
              </div>
              <InfoRow label="评论" value={detail.comment ?? '--'} multiline />
            </div>
          </>
        )}
        </div>
      </div>
      {albumGuard.dialog}
    </div>
  )
}

function InfoRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <span className={`text-sm text-neutral-100 ${multiline ? 'whitespace-pre-wrap leading-6' : 'truncate'}`}>{value}</span>
    </div>
  )
}

interface LinkedInfoRowProps {
  label: string
  items: { text: string; target: NavTarget }[]
  emptyText?: string
  /* 与 items 一一对应的非链接后缀（如角色 "(Primary)"），不需要下划线/点击跳转 */
  suffixes?: string[]
  onNavigate: (target: NavTarget) => void
}

/* 可点击跳转的信息行：多个项目用 " / " 分隔，每项点击后触发导航并关闭弹窗；只有名字本身是链接，后缀不带下划线 */
function LinkedInfoRow({ label, items, emptyText = '--', suffixes, onNavigate }: LinkedInfoRowProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {items.length === 0 ? (
        <span className="text-sm">{emptyText}</span>
      ) : (
        <div className="flex flex-wrap gap-1 text-sm text-neutral-100">
          {items.map((item, i) => (
            <span key={i}>
              <button
                onClick={() => onNavigate(item.target)}
                className="-mx-1 inline-flex min-h-8 items-center rounded-md px-1 text-neutral-200 underline decoration-neutral-500 underline-offset-4 transition hover:bg-white/[0.08] hover:text-white hover:decoration-neutral-200 active:scale-95"
              >
                {item.text}
              </button>
              {suffixes?.[i]}
              {i < items.length - 1 && <span className="text-neutral-500"> / </span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
