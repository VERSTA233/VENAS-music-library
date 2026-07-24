import { useEffect, useState } from 'react'
import type { AlbumRow, AlbumMatchCandidate } from '../../../shared/types'
import ArtistPicker, { type ArtistFormEntry } from './ArtistPicker'

/* album_type 建议值（非数据库约束，仅作为下拉候选，用户可自由输入其他类型） */
const ALBUM_TYPE_SUGGESTIONS = ['Album', 'EP', 'Single', 'Live', 'Compilation']

/* 专辑被显式选定时的字段快照（不含曲目号/碟号，这两项恒为单曲自身属性），用于判断选定后是否发生了"脏改动" */
export interface AlbumSnapshot {
  releaseDate: string
  albumType: string
  totalDiscs: string
  label: string
  artists: ArtistFormEntry[]
}

export interface AlbumFormState {
  title: string
  releaseDate: string
  albumType: string
  /* 专辑总碟数：专辑级属性，不随单曲变化 */
  totalDiscs: string
  /* 专辑厂牌 */
  label: string
  /* 这首歌在专辑内所处的碟号/曲目号 */
  discNumber: string
  trackNumber: string
  /* 专辑艺术家：来自音频 albumartist 字段或用户手填，role 字段始终不展示不使用 */
  artists: ArtistFormEntry[]
  /* 用户已从下拉框显式选定、或去重/改动确认框流程确认使用的专辑 id；null 表示尚未选定（入库时将新建） */
  selectedAlbumId: number | null
  /* 选定那一刻的字段快照，供提交前比对是否被手动改动过 */
  selectedAlbumSnapshot: AlbumSnapshot | null
}

interface AlbumPickerProps {
  value: AlbumFormState
  onChange: (value: AlbumFormState) => void
}

function toArtistFormEntries(artists: { name: string; order: number }[]): ArtistFormEntry[] {
  return artists.map((a) => ({ name: a.name, role: 'Primary', order: a.order }))
}

/* 比较当前表单的专辑字段（不含曲目号/碟号）与选定时的快照是否一致，供提交前判断是否需要弹出"改动确认框" */
export function albumFieldsDirty(value: AlbumFormState): boolean {
  const snapshot = value.selectedAlbumSnapshot
  if (!snapshot) return false
  const artistsEqual =
    value.artists.map((a) => a.name.trim().toLowerCase()).join('|') ===
    snapshot.artists.map((a) => a.name.trim().toLowerCase()).join('|')
  return (
    value.releaseDate !== snapshot.releaseDate ||
    value.albumType !== snapshot.albumType ||
    value.totalDiscs !== snapshot.totalDiscs ||
    value.label !== snapshot.label ||
    !artistsEqual
  )
}

/* 把某个已选定的专辑候选转换为可直接写入 AlbumFormState 的字段（不含曲目号/碟号，沿用调用方原值） */
export function applyAlbumCandidate(
  value: AlbumFormState,
  album: AlbumRow,
  artists: { name: string; order: number }[]
): AlbumFormState {
  const artistEntries = toArtistFormEntries(artists)
  const snapshot: AlbumSnapshot = {
    releaseDate: album.release_date ?? '',
    albumType: album.album_type ?? ALBUM_TYPE_SUGGESTIONS[0],
    totalDiscs: album.total_discs != null ? String(album.total_discs) : '',
    label: album.label ?? '',
    artists: artistEntries
  }
  return {
    title: album.title,
    releaseDate: snapshot.releaseDate,
    albumType: snapshot.albumType,
    totalDiscs: snapshot.totalDiscs,
    label: snapshot.label,
    discNumber: value.discNumber,
    trackNumber: value.trackNumber,
    artists: artistEntries,
    selectedAlbumId: album.id,
    selectedAlbumSnapshot: snapshot
  }
}

/* 单曲的所属专辑编辑器：专辑名可选，留空表示不入专辑；填了名字才展示发行日期/类型/碟号/曲目号/总碟数/厂牌/专辑艺术家 */
export default function AlbumPicker({ value, onChange }: AlbumPickerProps): React.JSX.Element {
  /* 按标题 LIKE 搜索得到的候选：既用作输入时的自动完成下拉框，也用来判断标题是否与已有专辑精确同名（红/黄/绿灯） */
  const [matches, setMatches] = useState<AlbumMatchCandidate[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  /* 厂牌本质上是 artist（type='Label'），与艺术家编辑器一样用绿/红指示灯提示入库时是复用已有还是新建 */
  const [labelMatched, setLabelMatched] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    const name = value.label.trim()
    if (!name) {
      setLabelMatched(undefined)
      return
    }
    let cancelled = false
    window.api.artists.matchExact(name).then((matched) => {
      if (!cancelled) setLabelMatched(matched)
    })
    return () => {
      cancelled = true
    }
  }, [value.label])

  /*
   * 无论标题是用户手打的还是程序回填的（如编辑已有歌曲、入库时从 albumartist 自动预填），
   * 只要标题变化就重新拉取同名候选，保证红/黄/绿灯与去重下拉框始终反映当前标题的真实匹配状态。
   */
  useEffect(() => {
    const title = value.title.trim()
    if (!title) {
      setMatches([])
      setMatchLoading(false)
      return
    }
    let cancelled = false
    setMatchLoading(true)
    window.api.albums.search(title).then((results) => {
      if (cancelled) return
      setMatches(results)
      setMatchLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [value.title])

  function handleTitleChange(title: string): void {
    // 手动改动标题文本视为放弃此前的选定，重新判定红/黄/绿灯
    onChange({ ...value, title, selectedAlbumId: null, selectedAlbumSnapshot: null })
  }

  async function pickExisting(album: AlbumRow): Promise<void> {
    const detail = await window.api.albums.detail(album.id)
    onChange(applyAlbumCandidate(value, album, detail?.artists ?? []))
  }

  function digitsOnly(v: string): string {
    return v.replace(/[^0-9]/g, '')
  }

  const title = value.title.trim()
  const exactMatchCount = matches.filter((a) => a.title.trim().toLowerCase() === title.toLowerCase()).length
  const matchColor: 'red' | 'yellow' | 'green' | undefined = !title
    ? undefined
    : value.selectedAlbumId != null
      ? 'green'
      : matchLoading
        ? undefined
        : exactMatchCount > 0
          ? 'yellow'
          : 'red'

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded px-2 py-1 focus-within:border-white/30">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              matchColor === undefined
                ? 'bg-neutral-600'
                : matchColor === 'green'
                  ? 'bg-green-500'
                  : matchColor === 'yellow'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
            }`}
            title={
              matchColor === undefined
                ? '匹配中...'
                : matchColor === 'green'
                  ? '已选定数据库中的专辑'
                  : matchColor === 'yellow'
                    ? '存在同名专辑，但尚未选定，请从下方列表中选择或确认新建'
                    : '数据库中不存在同名专辑，入库时将新建'
            }
          />
          <input
            value={value.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="专辑名"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none"
          />
        </div>
        {matches.length > 0 && value.selectedAlbumId == null && (
          <div className="absolute z-10 mt-1 w-full bg-neutral-900 border border-white/10 rounded shadow-lg max-h-40 overflow-y-auto">
            {matches.map((a) => (
              <div
                key={a.id}
                onClick={() => pickExisting(a)}
                className="px-2 py-1 text-sm hover:bg-white/10 cursor-default flex justify-between gap-2"
              >
                <span className="truncate">{a.title}</span>
                <span className="text-neutral-500 text-xs flex-shrink-0">
                  {a.artistNames || '未知艺术家'}
                  {a.release_date ? ` · ${a.release_date}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {value.title.trim() && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">专辑艺术家</label>
            <ArtistPicker
              artists={value.artists}
              onChange={(artists) => onChange({ ...value, artists })}
              showRole={false}
            />
          </div>
          <div className="flex items-center gap-2 bg-white/5 rounded px-2 py-1">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                labelMatched === undefined ? 'bg-neutral-600' : labelMatched ? 'bg-green-500' : 'bg-red-500'
              }`}
              title={
                labelMatched === undefined
                  ? '匹配中...'
                  : labelMatched
                    ? '已匹配数据库中的艺术家'
                    : '数据库中不存在，入库时将新建'
              }
            />
            <input
              value={value.label}
              onChange={(e) => onChange({ ...value, label: e.target.value })}
              placeholder="厂牌"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-white/30"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={value.releaseDate}
              onChange={(e) => onChange({ ...value, releaseDate: e.target.value })}
              placeholder="发行日期（YYYY-MM-DD）"
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
            />
            <select
              value={value.albumType}
              onChange={(e) => onChange({ ...value, albumType: e.target.value })}
              className="bg-white/5 border border-white/10 rounded text-sm px-1 outline-none"
            >
              {ALBUM_TYPE_SUGGESTIONS.map((t) => (
                <option key={t} value={t} className="bg-neutral-900">
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <input
              value={value.trackNumber}
              onChange={(e) => onChange({ ...value, trackNumber: digitsOnly(e.target.value) })}
              placeholder="曲目号"
              className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
            />
            <input
              value={value.discNumber}
              onChange={(e) => onChange({ ...value, discNumber: digitsOnly(e.target.value) })}
              placeholder="碟号"
              className="w-16 ml-auto bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
            />
            <span className="text-neutral-500 text-xs">/</span>
            <input
              value={value.totalDiscs}
              onChange={(e) => onChange({ ...value, totalDiscs: digitsOnly(e.target.value) })}
              placeholder="总碟数"
              className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm outline-none focus:border-white/30"
            />
          </div>
        </div>
      )}
    </div>
  )
}
