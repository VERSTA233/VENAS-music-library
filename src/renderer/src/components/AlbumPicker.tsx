import { useEffect, useRef, useState } from 'react'
import type { AlbumRow, AlbumMatchCandidate } from '../../../shared/types'
import ArtistPicker, { type ArtistFormEntry } from './ArtistPicker'
import LabelPicker from './LabelPicker'
import YMDDateInput from './YMDDateInput'

import { ALBUM_TYPE_SUGGESTIONS, albumTypeOptions } from '../constants/albumTypes'

/* 专辑被显式选定时的字段快照（不含曲目号/碟号，这两项恒为单曲自身属性），用于判断选定后是否发生了"脏改动" */
export interface AlbumSnapshot {
  releaseDate: string
  albumType: string
  totalDiscs: string
  labels: string[]
  artists: ArtistFormEntry[]
}

export interface AlbumFormState {
  title: string
  releaseDate: string
  albumType: string
  /* 专辑总碟数：专辑级属性，不随单曲变化 */
  totalDiscs: string
  /* 专辑厂牌 */
  labels: string[]
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
  /* 修改专辑艺术家的 type 时，调用方可借此同步歌曲艺术家列表中同名条目的 type（仅红灯时触发） */
  onArtistTypeChange?: (name: string, type: 'Person' | 'Group' | null) => void
}

function toArtistFormEntries(artists: { name: string; order: number }[]): ArtistFormEntry[] {
  return artists.map((a) => ({ name: a.name, role: 'Primary', order: a.order, type: null }))
}

/* 比较当前表单的专辑字段（不含曲目号/碟号）与选定时的快照是否一致，供提交前判断是否需要弹出"改动确认框" */
export function albumFieldsDirty(value: AlbumFormState): boolean {
  const snapshot = value.selectedAlbumSnapshot
  if (!snapshot) return false
  const artistsEqual =
    value.artists.map((a) => a.name.trim().toLowerCase()).join('|') ===
    snapshot.artists.map((a) => a.name.trim().toLowerCase()).join('|')
  const labelsEqual =
    value.labels.map((label) => label.trim().toLowerCase()).join('|') ===
    snapshot.labels.map((label) => label.trim().toLowerCase()).join('|')
  return (
    value.releaseDate !== snapshot.releaseDate ||
    value.albumType !== snapshot.albumType ||
    value.totalDiscs !== snapshot.totalDiscs ||
    !labelsEqual ||
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
    labels: album.labels.map((label) => label.name),
    artists: artistEntries
  }
  /* 总碟数已登记为 1 的专辑不存在碟号歧义，尚未手动填写碟号时直接预填 1，省去单碟专辑逐首手动填写的麻烦 */
  const discNumber = !value.discNumber.trim() && snapshot.totalDiscs === '1' ? '1' : value.discNumber
  return {
    title: album.title,
    releaseDate: snapshot.releaseDate,
    albumType: snapshot.albumType,
    totalDiscs: snapshot.totalDiscs,
    labels: snapshot.labels,
    discNumber,
    trackNumber: value.trackNumber,
    artists: artistEntries,
    selectedAlbumId: album.id,
    selectedAlbumSnapshot: snapshot
  }
}

/* 单曲的所属专辑编辑器：专辑名可选，留空表示不入专辑；填了名字才展示发行日期/类型/碟号/曲目号/总碟数/厂牌/专辑艺术家 */
export default function AlbumPicker({ value, onChange, onArtistTypeChange }: AlbumPickerProps): React.JSX.Element {
  /* 按标题 LIKE 搜索得到的候选：既用作输入时的自动完成下拉框，也用来判断标题是否与已有专辑精确同名（红/黄/绿灯） */
  const [matches, setMatches] = useState<AlbumMatchCandidate[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const suggestionRootRef = useRef<HTMLDivElement>(null)
  const dismissedTitleRef = useRef<string | null>(null)
  /*
   * 无论标题是用户手打的还是程序回填的（如编辑已有歌曲、入库时从 albumartist 自动预填），
   * 只要标题变化就重新拉取同名候选，保证红/黄/绿灯与去重下拉框始终反映当前标题的真实匹配状态。
   */
  useEffect(() => {
    const title = value.title.trim()
    if (!title) {
      setMatches([])
      setMatchLoading(false)
      setSuggestionsOpen(false)
      return
    }
    let cancelled = false
    setMatchLoading(true)
    window.api.albums.search(title).then((results) => {
      if (cancelled) return
      setMatches(results)
      setMatchLoading(false)
      if (dismissedTitleRef.current !== title) setSuggestionsOpen(results.length > 0)
    })
    return () => {
      cancelled = true
    }
  }, [value.title])

  useEffect(() => {
    if (!suggestionsOpen) return
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (suggestionRootRef.current?.contains(event.target as Node)) return
      dismissedTitleRef.current = value.title.trim()
      setSuggestionsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [suggestionsOpen, value.title])

  function handleTitleChange(title: string): void {
    // 手动改动标题文本视为放弃此前的选定，重新判定红/黄/绿灯
    dismissedTitleRef.current = null
    setSuggestionsOpen(true)
    onChange({ ...value, title, selectedAlbumId: null, selectedAlbumSnapshot: null })
  }

  async function pickExisting(album: AlbumRow): Promise<void> {
    const detail = await window.api.albums.detail(album.id)
    setSuggestionsOpen(false)
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
      <div ref={suggestionRootRef} className="relative">
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
            onKeyDown={(e) => {
              if (e.key === 'Tab' && suggestionsOpen && matches[0] && value.selectedAlbumId == null) {
                e.preventDefault()
                void pickExisting(matches[0])
              }
            }}
            onFocus={() => {
              dismissedTitleRef.current = null
              if (matches.length > 0 && value.selectedAlbumId == null) setSuggestionsOpen(true)
            }}
            placeholder="专辑名"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none"
          />
        </div>
        {suggestionsOpen && matches.length > 0 && value.selectedAlbumId == null && (
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
              onTypeChange={onArtistTypeChange}
            />
          </div>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1 transition focus-within:border-white/30">
            <LabelPicker values={value.labels} onChange={(labels) => onChange({ ...value, labels })} />
          </div>
          <div className="flex gap-2">
            <YMDDateInput
              value={value.releaseDate}
              onChange={(releaseDate) => onChange({ ...value, releaseDate })}
              className="flex-1"
            />
            <select
              value={value.albumType}
              onChange={(e) => {
                const albumType = e.target.value
                const isSingleDiscRelease = albumType === 'Single' || albumType === 'EP'
                onChange({
                  ...value,
                  albumType,
                  discNumber: isSingleDiscRelease ? '1' : value.discNumber,
                  totalDiscs: isSingleDiscRelease ? '1' : value.totalDiscs
                })
              }}
              className="bg-white/5 border border-white/10 rounded text-sm px-1 outline-none"
            >
              {albumTypeOptions(value.albumType).map((t) => (
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
