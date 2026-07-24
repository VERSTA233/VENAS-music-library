import type { TagRow } from '../../../shared/types'
import ArtistPicker, { type ArtistFormEntry } from './ArtistPicker'
import TagPicker from './TagPicker'
import AlbumPicker, { type AlbumFormState } from './AlbumPicker'

export interface SongFormValue {
  title: string
  bpm: string
  /* 用户手动登记的初次聆听日期（YYYY-MM-DD），非系统自动写入，留空表示未登记 */
  firstHeardDate: string
  lyric: string
  /* 当前歌词内容来自哪个源文件的绝对路径（供入库场景在保存成功后据此删除该文件）；手填或未导入过为 null */
  lyricFilePath: string | null
  artists: ArtistFormEntry[]
  tags: TagRow[]
  album: AlbumFormState
  /* 评分 0-100，留空表示未评分 */
  score: string
  comment: string
}

interface SongFormProps {
  value: SongFormValue
  onChange: (value: SongFormValue) => void
}

/*
 * 歌曲信息的通用编辑表单：曲名/艺术家/专辑/歌词(含导入)/BPM/Tags，
 * 供"添加到音乐库"与"编辑歌曲信息"两个界面共用，保持字段顺序与交互一致。
 */
export default function SongForm({ value, onChange }: SongFormProps): React.JSX.Element {
  /* 弹出系统文件选择对话框导入歌词，可选任意目录下的 .lrc 文件 */
  async function handlePickLyricFile(): Promise<void> {
    const picked = await window.api.append.pickLyricFile()
    if (!picked) return
    onChange({ ...value, lyric: picked.content, lyricFilePath: picked.filePath })
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">曲名</label>
        <input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">艺术家</label>
        <ArtistPicker artists={value.artists} onChange={(artists) => onChange({ ...value, artists })} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">专辑</label>
        <AlbumPicker value={value.album} onChange={(album) => onChange({ ...value, album })} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">歌词</label>
          <div className="ml-auto flex items-center gap-2 min-w-0">
            {value.lyricFilePath && (
              <span className="text-xs text-neutral-500 truncate">{value.lyricFilePath.split(/[/\\]/).pop()}</span>
            )}
            <button
              onClick={handlePickLyricFile}
              className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20"
            >
              导入...
            </button>
          </div>
        </div>
        <textarea
          value={value.lyric}
          onChange={(e) => onChange({ ...value, lyric: e.target.value })}
          rows={4}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30 resize-none"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-500">初次聆听日期</label>
          <input
            value={value.firstHeardDate}
            onChange={(e) => onChange({ ...value, firstHeardDate: e.target.value })}
            placeholder="YYYY-MM-DD"
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
          />
        </div>
        <div className="flex flex-col gap-1 w-24">
          <label className="text-xs text-neutral-500">BPM</label>
          <input
            value={value.bpm}
            onChange={(e) => onChange({ ...value, bpm: e.target.value.replace(/[^0-9]/g, '') })}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">Tags</label>
        <TagPicker tags={value.tags} onChange={(tags) => onChange({ ...value, tags })} />
      </div>

      <div className="flex flex-col gap-1 w-24">
        <label className="text-xs text-neutral-500">评分</label>
        <input
          value={value.score}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, '')
            const clamped = digits && Number(digits) > 100 ? '100' : digits
            onChange({ ...value, score: clamped })
          }}
          placeholder="0-100"
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">评论</label>
        <textarea
          value={value.comment}
          onChange={(e) => onChange({ ...value, comment: e.target.value })}
          rows={3}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30 resize-none"
        />
      </div>
    </>
  )
}
