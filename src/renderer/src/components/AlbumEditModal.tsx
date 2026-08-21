import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { AlbumRow, AlbumUpdateData } from '../../../shared/types'
import ArtistPicker, { type ArtistFormEntry } from './ArtistPicker'
import LabelPicker from './LabelPicker'
import Cover from './Cover'
import YMDDateInput from './YMDDateInput'
import { usePlayerStore } from '../stores/playerStore'

const ALBUM_TYPE_SUGGESTIONS = ['Album', 'EP', 'Single', 'Live', 'Compilation']

interface AlbumEditModalProps {
  album: AlbumRow
  artists: { id: number; name: string; order: number }[]
  onClose: () => void
  onSaved: () => void
  onCoverChanged?: () => void
}

/* 专辑资料编辑：专辑封面是专辑级缓存，选取新图片后立即覆盖并刷新当前详情页。 */
export default function AlbumEditModal({ album, artists, onClose, onSaved, onCoverChanged }: AlbumEditModalProps): React.JSX.Element {
  const [title, setTitle] = useState(album.title)
  const [releaseDate, setReleaseDate] = useState(album.release_date ?? '')
  const [albumType, setAlbumType] = useState(album.album_type ?? 'Album')
  const [totalDiscs, setTotalDiscs] = useState(album.total_discs != null ? String(album.total_discs) : '')
  const [labels, setLabels] = useState(album.labels.map((label) => label.name))
  const [albumArtists, setAlbumArtists] = useState<ArtistFormEntry[]>(
    artists.map((artist) => ({ name: artist.name, role: 'Primary', order: artist.order, type: null }))
  )
  const [pictureVersion, setPictureVersion] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasTrack = usePlayerStore((state) => state.currentIndex !== null)
  const typeOptions = Array.from(new Set([albumType, ...ALBUM_TYPE_SUGGESTIONS].filter(Boolean)))

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await window.api.albums.setManualCover(album.id, bytes)
      setPictureVersion((version) => version + 1)
      onCoverChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave(): Promise<void> {
    const nextTitle = title.trim()
    if (!nextTitle) {
      setError('专辑名不能为空')
      return
    }
    setSaving(true)
    setError(null)
    const data: AlbumUpdateData = {
      title: nextTitle,
      releaseDate: releaseDate.trim() || null,
      albumType: albumType.trim() || null,
      totalDiscs: totalDiscs.trim() ? Number(totalDiscs) : null,
      labels,
      artists: albumArtists
        .filter((artist) => artist.name.trim())
        .map((artist, order) => ({ name: artist.name.trim(), order, type: artist.type }))
    }
    try {
      await window.api.albums.update(album.id, data)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const busy = uploading || saving

  return (
    <div className={`modal-safe-area fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm${hasTrack ? ' pb-[92px]' : ''}`} role="dialog" aria-modal="true" aria-labelledby="album-edit-title">
      <div className={`flex w-[min(620px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1b1b1f]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl ${hasTrack ? 'max-h-[calc(100dvh-140px)]' : 'max-h-[calc(100dvh-4rem)]'}`}>
        <div className="window-drag-region flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <h2 id="album-edit-title" className="truncate text-base font-semibold text-white">编辑专辑</h2>
          <button type="button" onClick={onClose} disabled={busy} className="library-icon-button disabled:opacity-30" title="关闭" aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white/[0.05] ring-1 ring-white/[0.08]">
              <Cover cacheKey={`${album.id}-${pictureVersion}`} load={() => window.api.albums.cover(album.id)} className="h-full w-full object-cover" />
            </div>
            <label className={`flex cursor-pointer items-center gap-2 text-sm text-neutral-400 transition hover:text-white ${busy ? 'pointer-events-none opacity-40' : ''}`}>
              <ImagePlus size={17} />
              {uploading ? '正在上传封面...' : '更换专辑封面'}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} disabled={busy} className="hidden" />
            </label>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
              专辑名
              <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
                发行日期
                <YMDDateInput value={releaseDate} onChange={setReleaseDate} className="!justify-start" />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
                专辑类型
                <select value={albumType} onChange={(event) => setAlbumType(event.target.value)} disabled={busy} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40">
                  {typeOptions.map((option) => <option key={option} value={option} className="bg-neutral-900">{option}</option>)}
                </select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
                总碟数
                <input value={totalDiscs} onChange={(event) => setTotalDiscs(event.target.value.replace(/[^0-9]/g, ''))} disabled={busy} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40" />
              </label>
              <div className="flex flex-col gap-1.5 text-xs text-neutral-500">
                <span>厂牌</span>
                <div className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 focus-within:border-white/[0.25] focus-within:bg-white/[0.08]">
                  <LabelPicker values={labels} onChange={setLabels} disabled={busy} />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-neutral-500">专辑艺术家</label>
              <ArtistPicker artists={albumArtists} onChange={setAlbumArtists} showRole={false} />
            </div>
          </div>

          {error && <p className="mt-4 rounded-lg bg-red-400/[0.08] px-3 py-2 text-xs text-red-200">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30">取消</button>
            <button type="button" onClick={handleSave} disabled={busy} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-40">{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
