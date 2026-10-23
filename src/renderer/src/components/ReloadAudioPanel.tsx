import { useRef, useState } from 'react'
import type { ReloadFileSelection } from '../../../shared/types'

interface ReloadAudioPanelProps {
  songId: number
  currentFileName: string
  targetFileName: string
  onTargetFileNameChange: (fileName: string) => void
  selectedFile: ReloadFileSelection | null
  onSelectedFileChange: (file: ReloadFileSelection | null) => void
}

/*
 * 重载音频文件面板：可选择任意位置的音频，实际移动与替换随歌曲信息保存一起执行。
 */
export default function ReloadAudioPanel({
  songId,
  currentFileName,
  targetFileName,
  onTargetFileNameChange,
  selectedFile,
  onSelectedFileChange
}: ReloadAudioPanelProps): React.JSX.Element {
  const [coverAction, setCoverAction] = useState<'embedded' | 'upload' | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)
  const [coverMessage, setCoverMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function updateCover(action: 'embedded' | 'upload', file?: File): Promise<void> {
    setCoverAction(action)
    setCoverError(null)
    setCoverMessage(null)
    try {
      if (action === 'embedded') {
        await window.api.songs.reloadEmbeddedCover(songId)
      } else if (file) {
        await window.api.songs.setManualCover(songId, new Uint8Array(await file.arrayBuffer()))
      }
      window.dispatchEvent(new Event('library:cover-updated'))
      setCoverMessage(action === 'embedded' ? '已从内嵌封面更新' : '封面已上传')
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : '封面更新失败，请重试')
    } finally {
      setCoverAction(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handlePickFile(): Promise<void> {
    const picked = await window.api.songs.pickReloadFile()
    if (picked) {
      onSelectedFileChange(picked)
      /* 替换音频默认原名移动进 Music；上方输入框仍可供用户明确要求改名时使用。 */
      onTargetFileNameChange(picked.fileName)
    }
  }

  async function handleManualCover(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    await updateCover('upload', file)
  }

  return (
    <div className="flex flex-col gap-2 mt-2 bg-white/5 rounded p-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`song-file-name-${songId}`} className="text-xs text-neutral-500">音频文件名</label>
        <input
          id={`song-file-name-${songId}`}
          value={targetFileName}
          onChange={(event) => onTargetFileNameChange(event.target.value)}
          spellCheck={false}
          className="rounded-lg border border-white/[0.1] bg-black/10 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.04]"
        />
        {targetFileName.trim() !== currentFileName && (
          <span className="text-xs text-neutral-600">保存后同步重命名 Music 中的音频文件。</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={handlePickFile}
          className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs transition hover:bg-white/20 active:scale-[0.98]"
        >
          选择替换音频...
        </button>
        {selectedFile && <span className="min-w-0 truncate text-xs text-neutral-500" title={selectedFile.filePath}>{selectedFile.fileName}</span>}
        {selectedFile && <button type="button" onClick={() => onSelectedFileChange(null)} className="shrink-0 text-xs text-neutral-500 hover:text-white">清除</button>}
      </div>
      <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
        <span className="text-xs text-neutral-500">封面重载</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void updateCover('embedded')} disabled={coverAction !== null || selectedFile !== null}
            className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs transition hover:bg-white/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
            {coverAction === 'embedded' ? '更新封面中...' : '从内嵌封面更新'}
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={coverAction !== null}
            className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs transition hover:bg-white/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
            {coverAction === 'upload' ? '上传封面中...' : '手动上传封面'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleManualCover}
            disabled={coverAction !== null}
            className="hidden"
          />
        </div>
        {selectedFile && <p className="text-xs text-neutral-500">已选择替换音频，请先保存，再从新音频更新内嵌封面。</p>}
        {coverError && <p role="alert" className="text-xs text-red-300">{coverError}</p>}
        {coverMessage && <p role="status" className="text-xs text-neutral-300">{coverMessage}</p>}
      </div>
    </div>
  )
}
