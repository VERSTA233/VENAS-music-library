import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { TagRow } from '../../../shared/types'
import { usePlayerStore } from '../stores/playerStore'
import { TAG_TYPE_OPTIONS } from '../tagTypes'

interface TagEditModalProps {
  tag: TagRow
  onClose: () => void
  onSaved: (tagType: string | null) => void
  onDeleted: () => void
}

/* Tag 可修改名称和所属类型；删除仅清除该 Tag 与歌曲的关系，不影响歌曲本身。 */
export default function TagEditModal({ tag, onClose, onSaved, onDeleted }: TagEditModalProps): React.JSX.Element {
  const [name, setName] = useState(tag.name)
  const [tagType, setTagType] = useState(tag.tag_type ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDeletion, setConfirmingDeletion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasTrack = usePlayerStore((state) => state.currentIndex !== null)

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const nextTagType = tagType || null
      await window.api.tags.update(tag.id, { name, tagType: nextTagType })
      onSaved(nextTagType)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    setDeleting(true)
    setError(null)
    try {
      await window.api.tags.delete(tag.id)
      onDeleted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={`modal-safe-area fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm${hasTrack ? ' pb-[92px]' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tag-edit-title">
      <div className={`flex w-[min(500px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#1b1b1f]/95 shadow-2xl shadow-black/50 backdrop-blur-2xl ${hasTrack ? 'max-h-[calc(100dvh-140px)]' : 'max-h-[calc(100dvh-4rem)]'}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <h2 id="tag-edit-title" className="truncate text-base font-semibold text-white">编辑 {tag.name}</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setConfirmingDeletion((value) => !value)} disabled={saving || deleting} className="library-icon-button text-neutral-500 hover:text-red-300 disabled:opacity-30" title="删除 Tag" aria-label="删除 Tag"><Trash2 size={16} /></button>
            <button type="button" onClick={onClose} disabled={saving || deleting} className="library-icon-button disabled:opacity-30" title="关闭" aria-label="关闭"><X size={18} /></button>
          </div>
        </div>
        <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 flex flex-col gap-1.5">
            <label htmlFor="tag-name" className="text-xs text-neutral-500">Tag 名称</label>
            <input id="tag-name" value={name} onChange={(event) => setName(event.target.value)} disabled={saving || deleting} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08] disabled:opacity-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tag-type" className="text-xs text-neutral-500">Tag 类型</label>
            <select id="tag-type" value={tagType} onChange={(event) => setTagType(event.target.value)} className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.08]">
              {!TAG_TYPE_OPTIONS.includes(tagType as typeof TAG_TYPE_OPTIONS[number]) && <option value={tagType} className="bg-neutral-900">{tagType || '未分类'}</option>}
              {TAG_TYPE_OPTIONS.map((option) => <option key={option} value={option} className="bg-neutral-900">{option}</option>)}
            </select>
          </div>
          {confirmingDeletion && (
            <div className="mt-6 border-t border-white/[0.08] pt-5">
              <p className="text-sm leading-6 text-red-100">删除后会解除该 Tag 与所有歌曲的关联，歌曲及音频文件会被保留，无法恢复。</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmingDeletion(false)} disabled={deleting} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30">取消</button>
                <button type="button" onClick={remove} disabled={deleting} className="rounded-lg bg-red-300 px-3 py-2 text-sm font-medium text-black transition hover:bg-red-200 disabled:opacity-30">{deleting ? '正在删除...' : '确认删除'}</button>
              </div>
            </div>
          )}
          {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
        </div>
        {!confirmingDeletion && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-white/[0.08] px-6 py-4">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30">取消</button>
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-30">{saving ? '正在保存...' : '保存'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
