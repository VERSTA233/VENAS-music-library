import { useRef, useState } from 'react'

interface ReloadAudioPanelProps {
  songId: number
  currentFileName: string
  onReloaded: () => void
}

/*
 * 重载音频文件面板：弹出系统原生对话框从 Music/ 目录选择另一个文件替换当前歌曲的物理文件，
 * 仅重新提取 length + 封面；若封面提取/缓存失败，提示用户可手动上传封面兜底。
 */
export default function ReloadAudioPanel({ songId, currentFileName, onReloaded }: ReloadAudioPanelProps): React.JSX.Element {
  const [selected, setSelected] = useState('')
  const [reloading, setReloading] = useState(false)
  const [coverWarning, setCoverWarning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handlePickFile(): Promise<void> {
    const picked = await window.api.songs.pickReloadFile()
    if (picked) setSelected(picked)
  }

  async function handleReload(): Promise<void> {
    if (!selected) return
    setReloading(true)
    setCoverWarning(false)
    try {
      const result = await window.api.songs.reload(songId, selected)
      if (result.coverCacheFailed) {
        setCoverWarning(true)
      }
      onReloaded()
    } finally {
      setReloading(false)
    }
  }

  async function handleManualCover(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await window.api.songs.setManualCover(songId, bytes)
      setCoverWarning(false)
      onReloaded()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-2 bg-white/5 rounded p-3">
      <div className="text-xs text-neutral-500">
        当前文件：{currentFileName}（仅重新提取时长与封面）
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handlePickFile}
          className="text-xs px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20"
        >
          选择文件...
        </button>
        {selected && <span className="text-xs text-neutral-500 truncate">{selected}</span>}
      </div>
      <button
        onClick={handleReload}
        disabled={!selected || reloading}
        className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed self-start"
      >
        {reloading ? '重载中...' : '确认重载'}
      </button>

      {coverWarning && (
        <div className="flex flex-col gap-2 bg-amber-500/10 border border-amber-500/30 rounded p-2">
          <div className="text-xs text-amber-400">
            新文件没有内嵌封面，或封面缓存写入失败，列表将显示占位图。你可以手动上传一张图片作为封面：
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleManualCover}
            disabled={uploading}
            className="text-xs"
          />
        </div>
      )}
    </div>
  )
}
