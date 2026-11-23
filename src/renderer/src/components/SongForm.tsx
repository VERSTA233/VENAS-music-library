import type { SongUpdateData, TagRow } from '../../../shared/types'
import { Eraser } from 'lucide-react'
import ArtistPicker, { type ArtistFormEntry } from './ArtistPicker'
import TagPicker from './TagPicker'
import AlbumPicker, { type AlbumFormState } from './AlbumPicker'
import YMDDateInput from './YMDDateInput'
import { artistSelectionKey } from '../../../shared/artistSelection'

export interface SongFormValue {
  title: string
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

/* 入库与编辑共用字段转换；文件操作与 Tag 载荷仍由各自提交入口处理。 */
export function songFormMetadata(value: SongFormValue, album = value.album): Omit<SongUpdateData, 'fileName' | 'replacementFilePath' | 'tagIds'> {
  return {
    title: value.title.trim(),
    firstHeardDate: value.firstHeardDate.trim() || null,
    lyric: value.lyric.trim() || null,
    lyricFilePath: value.lyricFilePath,
    artists: value.artists,
    album: album.title.trim() ? {
      title: album.title.trim(),
      releaseDate: album.releaseDate.trim() || null,
      albumType: album.albumType || null,
      totalDiscs: album.totalDiscs.trim() ? Number(album.totalDiscs) : null,
      labels: album.labels,
      discNumber: album.discNumber.trim() ? Number(album.discNumber) : null,
      trackNumber: album.trackNumber.trim() ? Number(album.trackNumber) : null,
      artists: album.artists,
      albumId: album.selectedAlbumId
    } : null,
    score: value.score.trim() ? Number(value.score) : null,
    comment: value.comment.trim() || null
  }
}

interface SongFormProps {
  value: SongFormValue
  onChange: (value: SongFormValue) => void
  onOpenArtist?: (artistId: number) => void
  onOpenAlbum?: (albumId: number) => void
  onOpenTag?: (tag: TagRow) => void
}

/*
 * 歌曲信息的通用编辑表单：曲名/艺术家/专辑/歌词(含导入)/评分/Tags，
 * 供"添加到音乐库"与"编辑歌曲信息"两个界面共用，保持字段顺序与交互一致。
 */
export default function SongForm({ value, onChange, onOpenArtist, onOpenAlbum, onOpenTag }: SongFormProps): React.JSX.Element {
  /* 弹出系统文件选择对话框导入歌词，可选任意目录下的 .lrc 文件 */
  async function handlePickLyricFile(): Promise<void> {
    const picked = await window.api.append.pickLyricFile()
    if (!picked) return
    onChange({ ...value, lyric: picked.content, lyricFilePath: picked.filePath })
  }

  /*
   * 同步歌曲与专辑中同一个待新建艺术家的类型；按选择身份区分同名的已有记录。
   */
  function syncArtistType(artist: ArtistFormEntry, type: 'Person' | 'Group' | null): void {
    const key = artistSelectionKey(artist)
    const syncList = (list: ArtistFormEntry[]): ArtistFormEntry[] =>
      list.map((a) => (artistSelectionKey(a) === key ? { ...a, type } : a))
    onChange({ ...value, artists: syncList(value.artists), album: { ...value.album, artists: syncList(value.album.artists) } })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">歌名</label>
        <input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          className="h-8 bg-white/5 border border-white/10 rounded px-2 text-sm outline-none focus:border-white/30"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">艺术家</label>
        <ArtistPicker
          artists={value.artists}
          relatedArtists={value.album.artists}
          onOpenArtist={onOpenArtist}
          onChange={(artists) => onChange({ ...value, artists })}
          onTypeChange={syncArtistType}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-500">专辑</label>
        <AlbumPicker
          value={value.album}
          relatedArtists={value.artists}
          onOpenArtist={onOpenArtist}
          onOpenAlbum={onOpenAlbum}
          onChange={(album) => onChange({ ...value, album })}
          onArtistTypeChange={syncArtistType}
        />
      </div>

      <div className="-mb-2 flex flex-col gap-1">
        <label className="text-xs text-neutral-500">Tags</label>
        <TagPicker tags={value.tags} onChange={(tags) => onChange({ ...value, tags })} onOpenTag={onOpenTag} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">歌词</label>
          <div className="ml-auto flex items-center gap-2 min-w-0">
            {value.lyricFilePath && (
              <span className="text-xs text-neutral-500 truncate">{value.lyricFilePath.split(/[/\\]/).pop()}</span>
            )}
            <button
              type="button"
              onClick={() => onChange({ ...value, lyric: '', lyricFilePath: null })}
              disabled={!value.lyric && !value.lyricFilePath}
              className="library-icon-button h-7 w-7 disabled:cursor-not-allowed disabled:opacity-30"
              title="清空歌词并解除文件关联"
              aria-label="清空歌词并解除文件关联"
            >
              <Eraser size={15} />
            </button>
            <button
              type="button"
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
          <YMDDateInput value={value.firstHeardDate} onChange={(firstHeardDate) => onChange({ ...value, firstHeardDate })} />
        </div>
        <div className="flex w-24 flex-col gap-1">
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
    </div>
  )
}
