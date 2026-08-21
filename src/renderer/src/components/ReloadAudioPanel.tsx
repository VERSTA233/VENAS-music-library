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
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setUploading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      /* 封面上传仍立即写入缓存；音频替换则等待歌曲信息统一保存。 */
      await window.api.songs.setManualCover(songId, bytes)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-2 bg-white/5 rounded p-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`song-file-name-${songId}`} className="text-xs text-neutral-500">文件名</label>
        <input
          id={`song-file-name-${songId}`}
          value={targetFileName}
          onChange={(event) => onTargetFileNameChange(event.target.value)}
          spellCheck={false}
          className="rounded-lg border border-white/[0.1] bg-black/10 px-3 py-2 font-mono text-sm text-neutral-100 outline-none transition focus:border-white/[0.25] focus:bg-white/[0.04]"
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
      <div className="text-xs text-neutral-600">保存时会删除旧音频，并将选中的文件按原文件名移动到 Music。</div>
      <div className="flex items-center gap-2">
        <label className="cursor-pointer text-xs text-neutral-500 transition hover:text-white">
          {uploading ? '上传封面中...' : '手动上传封面'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleManualCover}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>
    </div>
  )
}
