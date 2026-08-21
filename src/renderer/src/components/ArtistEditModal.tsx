import { GitMerge, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ArtistAliasOf, ArtistAliasType, ArtistRow } from '../../../shared/types'
import Cover from './Cover'
import ArtistMemberPicker from './ArtistMemberPicker'
import { usePlayerStore } from '../stores/playerStore'

interface ArtistEditModalProps {
  artist: ArtistRow
  members?: ArtistRow[]
  aliasOf?: ArtistAliasOf | null
  allowTypeEdit?: boolean
  allowManagement?: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted?: () => void
  onPictureChanged?: () => void
}

const TYPE_OPTIONS: { value: 'Person' | 'Group'; label: string }[] = [
  { value: 'Person', label: 'Person' },
  { value: 'Group', label: 'Group' }
]

type ManagementMode = 'delete' | 'merge' | 'alias' | null

/* 艺术家编辑弹窗涵盖资料、头像、删除和合并；厂牌可复用资料部分，并显式禁用删除/合并。 */
export default function ArtistEditModal({
  artist,
  members = [],
  aliasOf = null,
  allowTypeEdit = true,
  allowManagement = true,
  onClose,
  onSaved,
  onDeleted,
  onPictureChanged
}: ArtistEditModalProps): React.JSX.Element {
  const [name, setName] = useState(artist.name)
  const [type, setType] = useState<'Person' | 'Group' | ''>(
    artist.type === 'Person' || artist.type === 'Group' ? artist.type : ''
  )
  const [country, setCountry] = useState(artist.country ?? '')
  const [selectedMembers, setSelectedMembers] = useState<ArtistRow[]>(members)
  const [pictureVersion, setPictureVersion] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [managementMode, setManagementMode] = useState<ManagementMode>(null)
  const [deleting, setDeleting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeQuery, setMergeQuery] = useState('')
  const [mergeCandidates, setMergeCandidates] = useState<ArtistRow[]>([])
  const [mergeTarget, setMergeTarget] = useState<ArtistRow | null>(null)
  const [aliasType, setAliasType] = useState<ArtistAliasType>('alias')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchRequestRef = useRef(0)
  const hasTrack = usePlayerStore((state) => state.currentIndex !== null)

  useEffect(() => {
    const requestId = ++searchRequestRef.current
    if ((managementMode !== 'merge' && managementMode !== 'alias') || !mergeQuery.trim()) {
      setMergeCandidates([])
      return
    }
    void window.api.artists.search(mergeQuery).then((results) => {
      if (requestId !== searchRequestRef.current) return
      setMergeCandidates(results.filter((candidate) => candidate.id !== artist.id && candidate.type !== 'Label'))
    })
  }, [artist.id, managementMode, mergeQuery])

  async function handleUploadPicture(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await window.api.artists.setManualPicture(artist.id, bytes)
      setPictureVersion((value) => value + 1)
      onPictureChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await window.api.artists.update(artist.id, {
        name,
        type: allowTypeEdit ? type || null : undefined,
        country: country.trim() || null,
        memberIds: selectedMembers.map((member) => member.id)
      })
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    setError(null)
    try {
      await window.api.artists.delete(artist.id)
      onDeleted?.()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDeleting(false)
    }
  }

  async function handleMerge(): Promise<void> {
    if (!mergeTarget) return
    setMerging(true)
    setError(null)
    try {
      await window.api.artists.merge(artist.id, mergeTarget.id)
      onDeleted?.()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setMerging(false)
    }
  }

  async function handleSetAlias(): Promise<void> {
    if (!mergeTarget) return
    setMerging(true)
    setError(null)
    try {
      await window.api.artists.setAlias(artist.id, mergeTarget.id, aliasType)
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setMerging(false)
    }
  }

  function chooseManagementMode(mode: ManagementMode): void {
    setError(null)
    setManagementMode(mode)
    setMergeQuery('')
    setMergeTarget(null)
  }

  const busy = saving || uploading || deleting || merging
  const effectiveType = allowTypeEdit ? type || null : artist.type
  const supportsMembers = effectiveType === 'Group' || effectiveType === 'Label'

  return (
    <div className={`modal-safe-area fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm${hasTrack ? ' pb-[92px]' : ''}`} role="dialog" aria-modal="true" aria-labelledby="artist-edit-title">
      <div className={`flex w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1b1b1f]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl ${hasTrack ? 'max-h-[calc(100dvh-140px)]' : 'max-h-[calc(100dvh-4rem)]'}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <h2 id="artist-edit-title" className="truncate text-base font-semibold text-white">编辑 {artist.name}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="library-icon-button disabled:opacity-30" title="关闭" aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white/[0.05]">
              <Cover cacheKey={`${artist.id}-${pictureVersion}`} load={() => window.api.artists.picture(artist.id)} className="h-full w-full object-cover" />
            </div>
            <label className="cursor-pointer text-sm text-neutral-400 transition hover:text-white">
              {uploading ? '正在上传头像...' : '更换头像'}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadPicture} disabled={busy} className="hidden" />
            </label>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="artist-name" className="text-xs text-neutral-500">名称</label>
              <input id="artist-name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40" />
            </div>
            {allowTypeEdit && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="artist-type" className="text-xs text-neutral-500">Type</label>
                <select id="artist-type" value={type} onChange={(event) => setType(event.target.value ? (event.target.value as 'Person' | 'Group') : '')} disabled={busy} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40">
                  <option value="" className="bg-neutral-900">未设置</option>
                  {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value} className="bg-neutral-900">{option.label}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="artist-country" className="text-xs text-neutral-500">Country</label>
              <input id="artist-country" value={country} onChange={(event) => setCountry(event.target.value)} disabled={busy} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40" />
            </div>
            {supportsMembers && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs text-neutral-500">成员</span>
                <ArtistMemberPicker
                  ownerId={artist.id}
                  members={selectedMembers}
                  onChange={setSelectedMembers}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          {allowManagement && (
            <div className="mt-6 border-t border-white/[0.08] pt-5">
              {managementMode === null && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => chooseManagementMode('merge')} disabled={busy} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"><GitMerge size={16} />合并艺术家</button>
                  {!aliasOf && <button type="button" onClick={() => chooseManagementMode('alias')} disabled={busy} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"><GitMerge size={16} />设为别名</button>}
                  <button type="button" onClick={() => chooseManagementMode('delete')} disabled={busy} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 transition hover:bg-red-400/[0.1] disabled:opacity-30"><Trash2 size={16} />删除艺术家</button>
                </div>
              )}
              {managementMode === 'delete' && (
                <div>
                  <p className="text-sm leading-6 text-red-100">删除后会解除该艺术家与所有歌曲、专辑的关联，并删除头像。歌曲、专辑及音频文件会被保留，无法恢复。</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => chooseManagementMode(null)} disabled={deleting} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30">取消</button>
                    <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-lg bg-red-300 px-3 py-2 text-sm font-medium text-black transition hover:bg-red-200 disabled:opacity-30">{deleting ? '正在删除...' : '确认删除'}</button>
                  </div>
                </div>
              )}
              {(managementMode === 'merge' || managementMode === 'alias') && (
                <div>
                  <label htmlFor="merge-artist" className="text-xs text-neutral-500">{managementMode === 'alias' ? '主艺名' : '合并到'}</label>
                  <input id="merge-artist" autoFocus value={mergeQuery} onChange={(event) => { setMergeQuery(event.target.value); setMergeTarget(null) }} placeholder="搜索目标艺术家" className="mt-1.5 w-full rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08]" />
                  {mergeCandidates.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto border-y border-white/[0.08] py-1">
                      {mergeCandidates.map((candidate) => (
                        <button key={candidate.id} type="button" onClick={() => setMergeTarget(candidate)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${mergeTarget?.id === candidate.id ? 'bg-white/[0.13] text-white' : 'text-neutral-300 hover:bg-white/[0.08]'}`}>
                          <span className="truncate">{candidate.name}</span>
                          <span className="ml-3 shrink-0 text-xs text-neutral-500">{candidate.type ?? '未设置'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {managementMode === 'alias' && (
                    <div className="mt-3 flex items-center gap-3">
                      <label htmlFor="alias-type" className="text-xs text-neutral-500">别名类型</label>
                      <select id="alias-type" value={aliasType} onChange={(event) => setAliasType(event.target.value as ArtistAliasType)} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-white/[0.25]">
                        <option value="alias" className="bg-neutral-900">alias</option>
                        <option value="former name" className="bg-neutral-900">former name</option>
                      </select>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-5 text-neutral-500">{managementMode === 'alias' ? '当前艺术家、歌曲关联和头像都会保留；主页副标题将显示其主艺名。' : '会将歌曲、专辑艺术家和厂牌关联转移到目标艺术家，然后删除当前艺术家与其头像。'}</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => chooseManagementMode(null)} disabled={merging} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30">取消</button>
                    <button type="button" onClick={managementMode === 'alias' ? handleSetAlias : handleMerge} disabled={!mergeTarget || merging} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30">{merging ? (managementMode === 'alias' ? '正在关联...' : '正在合并...') : (managementMode === 'alias' ? '确认关联' : '确认合并')}</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
        </div>
        {managementMode === null && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-white/[0.08] px-6 py-4">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30">取消</button>
            <button type="button" onClick={handleSave} disabled={saving || uploading} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30">{saving ? '正在保存...' : '保存'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
