import { useEffect, useState } from 'react'
import type { SongDetail } from '../../../shared/types'
import SongForm, { type SongFormValue } from './SongForm'
import ReloadAudioPanel from './ReloadAudioPanel'
import { useAlbumSubmitGuard } from './AlbumSubmitGuard'
import { useNavStore, type NavTarget, type ReturnContext } from '../stores/navStore'

interface SongEditModalProps {
  songId: number
  onClose: () => void
  onSaved: () => void
  /* 调用方（如 MusicView）传入时，点击艺术家/专辑/厂牌链接跳转后可以从详情页原样返回这里 */
  returnContext?: ReturnContext
}

const EMPTY_FORM: SongFormValue = {
  title: '',
  bpm: '',
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
    label: '',
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
    bpm: d.bpm != null ? String(d.bpm) : '',
    firstHeardDate: d.first_heard_date ?? '',
    lyric: d.lyric ?? '',
    lyricFilePath: null,
    artists: d.artists.map((a) => ({ name: a.name, role: a.role, order: a.order })),
    tags: d.tags.map((t) => ({ id: t.id, name: t.name, tag_type: t.tag_type, description: null })),
    album: album
      ? (() => {
          const releaseDate = album.release_date ?? ''
          const albumType = album.album_type ?? 'Album'
          const totalDiscs = album.total_discs != null ? String(album.total_discs) : ''
          const label = album.label ?? ''
          const artists = album.artists.map((a) => ({ name: a.name, role: 'Primary', order: a.order }))
          return {
            title: album.title,
            releaseDate,
            albumType,
            totalDiscs,
            label,
            discNumber: album.disc_number != null ? String(album.disc_number) : '',
            trackNumber: album.track_number != null ? String(album.track_number) : '',
            artists,
            // 歌曲本来就关联着这张专辑，视为隐式已选定（绿灯），编辑其字段同样受改动确认框保护
            selectedAlbumId: album.id,
            selectedAlbumSnapshot: { releaseDate, albumType, totalDiscs, label, artists }
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
  const { navigate } = useNavStore()
  const albumGuard = useAlbumSubmitGuard()

  useEffect(() => {
    window.api.songs.detail(songId).then((d) => {
      if (!d) return
      setDetail(d)
      setForm(detailToFormValue(d))
    })
  }, [songId])

  function startEditing(): void {
    if (detail) setForm(detailToFormValue(detail)) // 从最新数据重新填表，避免残留上次未保存的编辑
    setEditing(true)
  }

  function cancelEditing(): void {
    if (detail) setForm(detailToFormValue(detail)) // 丢弃改动
    setEditing(false)
    setShowReload(false)
  }

  async function handleSave(): Promise<void> {
    if (!form.title.trim() || form.artists.length === 0) return

    // 专辑黄灯（同名未选定）/绿灯脏改动需要用户先在弹框中确认，确认结果会回填到 form.album
    const guardResult = await albumGuard.check(form.album)
    if (!guardResult.proceed) {
      setForm((prev) => ({ ...prev, album: guardResult.album }))
      return
    }
    const album = guardResult.album

    setSaving(true)
    try {
      await window.api.songs.update(songId, {
        title: form.title.trim(),
        bpm: form.bpm.trim() ? Number(form.bpm) : null,
        firstHeardDate: form.firstHeardDate.trim() || null,
        lyric: form.lyric.trim() || null,
        artists: form.artists,
        tagIds: form.tags.map((t) => t.id),
        album: album.title.trim()
          ? {
              title: album.title.trim(),
              releaseDate: album.releaseDate.trim() || null,
              albumType: album.albumType || null,
              totalDiscs: album.totalDiscs.trim() ? Number(album.totalDiscs) : null,
              label: album.label.trim() || null,
              discNumber: album.discNumber.trim() ? Number(album.discNumber) : null,
              trackNumber: album.trackNumber.trim() ? Number(album.trackNumber) : null,
              artists: album.artists,
              albumId: album.selectedAlbumId
            }
          : null,
        score: form.score.trim() ? Number(form.score) : null,
        comment: form.comment.trim() || null
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (!detail) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
        <div className="text-neutral-400 text-sm">加载中...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-neutral-900 border border-white/10 rounded-lg w-[520px] max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">{editing ? '编辑歌曲信息' : '歌曲信息'}</h2>
          <div className="flex items-center gap-3">
            {!editing && (
              <button onClick={startEditing} className="text-xs text-neutral-400 hover:text-white underline">
                编辑
              </button>
            )}
            <button onClick={onClose} className="text-neutral-500 hover:text-white">
              ✕
            </button>
          </div>
        </div>

        {editing ? (
          <>
            <SongForm value={form} onChange={setForm} />

            <div className="border-t border-white/10 pt-3">
              <button onClick={() => setShowReload((v) => !v)} className="text-xs text-neutral-400 hover:text-white">
                {showReload ? '收起 ▲' : '重载音频文件 ▼'}
              </button>
              {showReload && (
                <ReloadAudioPanel songId={songId} currentFileName={detail.file_name} onReloaded={onSaved} />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={cancelEditing} className="text-sm px-3 py-1.5 rounded hover:bg-white/10 text-neutral-400">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim() || form.artists.length === 0}
                className="text-sm px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
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
                <InfoRow label="BPM" value={detail.bpm != null ? String(detail.bpm) : '--'} />
                <InfoRow label="歌词" value={detail.lyric ? '有' : '无'} />
                <InfoRow label="评分" value={detail.score != null ? String(detail.score) : '--'} />
              </div>
              <InfoRow
                label="Tags"
                value={detail.tags.length > 0 ? detail.tags.map((t) => t.name).join(' / ') : '--'}
              />
            </div>

            <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
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
                  {detail.album.label_id != null && detail.album.label ? (
                    <LinkedInfoRow
                      label="厂牌"
                      items={[{ text: detail.album.label, target: { view: 'artist', id: detail.album.label_id, isLabel: true } }]}
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

            <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
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
      {albumGuard.dialog}
    </div>
  )
}

function InfoRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className={`text-sm ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>{value}</span>
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
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral-500">{label}</span>
      {items.length === 0 ? (
        <span className="text-sm">{emptyText}</span>
      ) : (
        <div className="text-sm flex flex-wrap gap-1">
          {items.map((item, i) => (
            <span key={i}>
              <button
                onClick={() => onNavigate(item.target)}
                className="underline hover:text-neutral-300 transition-transform duration-150 ease-out active:scale-95"
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
