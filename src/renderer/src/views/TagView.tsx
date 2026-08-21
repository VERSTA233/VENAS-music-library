import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { TagTypeItem, TagListItem, TagRow, TagSongItem } from '../../../shared/types'
import { usePlayerStore } from '../stores/playerStore'
import { toMusicPlayerTrack } from '../playerTracks'
import SongList from '../components/SongList'
import SongListToolbarActions from '../components/SongListToolbarActions'
import RandomPlayButton from '../components/RandomPlayButton'
import SongEditModal from '../components/SongEditModal'
import { useNavStore } from '../stores/navStore'
import { filterSongs } from '../songSearch'
import TagEditModal from '../components/TagEditModal'
import BrowseToolbarActions from '../components/BrowseToolbarActions'

/*
 * Tag 分类导航三层结构：
 * 第一层 - 全部 tag_type 分组；第二层 - 该类型下的全部 Tag（含"新建 Tag"入口）；第三层 - 某个 Tag 关联的曲目详情页。
 */
export default function TagView(): React.JSX.Element {
  const [types, setTypes] = useState<TagTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TagRow[]>([])
  const [searching, setSearching] = useState(false)
  const { target, clearTarget, navigate, openRoot, requestReturn } = useNavStore()

  function loadTypes(): void {
    window.api.tags.listTypes().then((items) => {
      setTypes(items)
      setLoading(false)
    })
  }

  useEffect(() => {
    loadTypes()
  }, [])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      window.api.tags.search(normalizedQuery)
        .then((items) => {
          if (!cancelled) setSearchResults(items)
        })
        .catch(() => {
          if (!cancelled) setSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  /* 恢复或外部导航进来时，根据持久化目标恢复 Tag 类型层或具体 Tag。 */
  useEffect(() => {
    if (!target) return
    if (target.view === 'tag') {
      setSelectedTagId(target.id)
      setSelectedType(target.parentType ?? null)
    } else if (target.view === 'tagType') {
      setSelectedTagId(null)
      setSelectedType(target.tagType)
    } else {
      return
    }
    clearTarget()
  }, [target, clearTarget])

  function handleDetailBack(): void {
    if (requestReturn()) return
    setSelectedTagId(null)
    if (selectedType !== null) navigate({ view: 'tagType', tagType: selectedType })
    else openRoot('tag')
  }

  if (selectedTagId !== null) {
    return <TagDetail tagId={selectedTagId} onBack={handleDetailBack} onTagTypeChanged={(tagType) => {
      setSelectedType(tagType ?? '未分类')
      loadTypes()
    }} onDeleted={() => {
      loadTypes()
      setSelectedTagId(null)
      if (selectedType !== null) navigate({ view: 'tagType', tagType: selectedType })
      else openRoot('tag')
    }} />
  }

  if (selectedType !== null) {
    return (
      <TagTypeDetail
        tagType={selectedType}
        onBack={() => {
          setSelectedType(null)
          openRoot('tag')
        }}
        onSelectTag={(id) => navigate({ view: 'tag', id, parentType: selectedType })}
        onTypeCountChanged={loadTypes}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 justify-between border-b border-white/[0.08]">
        <div><h1 className="text-xl font-semibold leading-tight">Tag</h1></div>
        <BrowseToolbarActions
          query={query}
          onQueryChange={setQuery}
          placeholder="搜索 Tag"
          searchLabel="搜索 Tag"
          count={query.trim() ? searchResults.length : types.length}
          countUnit={query.trim() ? '个' : '个分类'}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {query.trim() ? (
          searching ? (
            <div className="px-4 py-8 text-center text-neutral-500 text-sm">搜索中...</div>
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-neutral-500 text-sm">没有匹配的 Tag</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {searchResults.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => navigate({ view: 'tag', id: tag.id })}
                  className="library-row flex items-center justify-between rounded-xl px-4 py-4 text-left hover:bg-white/[0.06]"
                >
                  <span className="truncate text-base font-medium text-neutral-100">{tag.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-neutral-500">{tag.tag_type ?? '未分类'}</span>
                </button>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : types.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">暂无 Tag</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {types.map((t) => (
              <button
                key={t.tag_type}
                onClick={() => navigate({ view: 'tagType', tagType: t.tag_type })}
                className="library-row flex items-center justify-between rounded-xl px-4 py-4 text-left hover:bg-white/[0.06]"
              >
                <span className="truncate text-base font-medium text-neutral-100">{t.tag_type}</span>
                <span className="ml-2 shrink-0 text-xs tabular-nums text-neutral-500">{t.tagCount} 个</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface TagTypeDetailProps {
  tagType: string
  onBack: () => void
  onSelectTag: (tagId: number) => void
  /* 新建 Tag 后该类型下 Tag 数会变化，通知父级重新拉取第一层的 tagCount */
  onTypeCountChanged: () => void
}

/* 第二层：某个 tag_type 下的全部 Tag，附带"新建 Tag"入口 */
function TagTypeDetail({ tagType, onBack, onSelectTag, onTypeCountChanged }: TagTypeDetailProps): React.JSX.Element {
  const [tags, setTags] = useState<TagListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newTagName, setNewTagName] = useState('')
  const [creating, setCreating] = useState(false)

  function load(): void {
    window.api.tags.listByType(tagType).then((items) => {
      setTags(items)
      setLoading(false)
    })
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagType])

  async function handleCreate(): Promise<void> {
    const name = newTagName.trim()
    if (!name) return
    setCreating(true)
    try {
      await window.api.tags.create(name, tagType)
      setNewTagName('')
      load()
      onTypeCountChanged()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 gap-3 border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="library-icon-button"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="truncate text-xl font-semibold leading-tight">{tagType}</h1>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            placeholder="新建 Tag 名称"
            className="h-8 w-[clamp(10rem,20vw,18rem)] min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.06] px-3 text-xs text-neutral-100 placeholder:text-neutral-600 outline-none transition focus:border-white/[0.2] focus:bg-white/[0.08]"
            aria-label="新建 Tag 名称"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newTagName.trim()}
            className="h-8 shrink-0 rounded-lg bg-white px-3 text-xs font-medium text-black transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
          >
            新建
          </button>
          <span className="shrink-0 text-xs text-neutral-500">{tags.length} 个标签</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : tags.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该分类下暂无 Tag</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => onSelectTag(tag.id)}
                className="library-row flex items-center justify-between rounded-xl px-4 py-4 text-left hover:bg-white/[0.06]"
              >
                <span className="truncate text-base font-medium text-neutral-100">{tag.name}</span>
                <span className="ml-2 shrink-0 text-xs tabular-nums text-neutral-500">{tag.songCount} 首</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface TagDetailProps {
  tagId: number
  onBack: () => void
  onTagTypeChanged: (tagType: string | null) => void
  onDeleted: () => void
}

/* 第三层：某个 Tag 关联的全部曲目，按 song_tags.sort_order 展示并支持拖拽重排。 */
function TagDetail({ tagId, onBack, onTagTypeChanged, onDeleted }: TagDetailProps): React.JSX.Element {
  const [tag, setTag] = useState<TagRow | null>(null)
  const [songs, setSongs] = useState<TagSongItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSong, setEditingSong] = useState<TagSongItem | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [query, setQuery] = useState('')
  const [savingOrder, setSavingOrder] = useState(false)
  const [editingTag, setEditingTag] = useState(false)
  const songsRef = useRef(songs)
  const { queue, currentIndex, playQueue, playRandomQueue } = usePlayerStore()

  function load(): void {
    window.api.tags.detail(tagId).then((detail) => {
      if (!detail) return
      setTag(detail.tag)
      setSongs(detail.songs)
      songsRef.current = detail.songs
      setLoading(false)
    })
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId])

  const currentSongId = currentIndex !== null ? queue[currentIndex]?.songId ?? null : null
  const filteredSongs = useMemo(
    () => filterSongs(songs, query, [tag?.name ?? '', tag?.tag_type ?? '']),
    [query, songs, tag?.name, tag?.tag_type]
  )

  function handleReorder(nextSongs: TagSongItem[]): void {
    songsRef.current = nextSongs
    setSongs(nextSongs)
  }

  async function persistOrder(): Promise<void> {
    if (savingOrder) return
    setSavingOrder(true)
    try {
      await window.api.tags.setSongOrder(tagId, songsRef.current.map((song) => song.id))
    } catch {
      load()
    } finally {
      setSavingOrder(false)
    }
  }

  function startEditComment(song: TagSongItem): void {
    setEditingCommentId(song.id)
    setCommentDraft(song.comment ?? '')
  }

  async function saveComment(songId: number): Promise<void> {
    const trimmed = commentDraft.trim()
    await window.api.tags.setSongComment(tagId, songId, trimmed || null)
    setEditingCommentId(null)
    load()
  }

  async function removeSong(songId: number): Promise<void> {
    await window.api.tags.removeSong(tagId, songId)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="library-toolbar sticky top-0 z-10 gap-3 border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="library-icon-button"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-medium truncate">{tag?.name ?? '...'}</h1>
        <button onClick={() => setEditingTag(true)} disabled={!tag} className="library-icon-button disabled:opacity-30" title="编辑 Tag" aria-label="编辑 Tag"><Pencil size={16} /></button>
        <SongListToolbarActions
          query={query}
          onQueryChange={setQuery}
          sort="library"
          onSortChange={() => undefined}
          count={filteredSongs.length}
          searchLabel="搜索当前 Tag"
          showSort={false}
          children={<RandomPlayButton onClick={() => playRandomQueue(filteredSongs.map(toMusicPlayerTrack))} disabled={filteredSongs.length === 0} />}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">加载中...</div>
        ) : filteredSongs.length === 0 ? (
          <div className="px-4 py-8 text-center text-neutral-500 text-sm">该 Tag 暂无关联曲目</div>
        ) : (
          <SongList
            songs={filteredSongs}
            currentSongId={currentSongId}
            onPlay={(index) =>
              playQueue(
                filteredSongs.map(toMusicPlayerTrack),
                index
              )
            }
            onEdit={(song) => setEditingSong(song)}
            onReorder={query || savingOrder ? undefined : handleReorder}
            onReorderEnd={query || savingOrder ? undefined : () => void persistOrder()}
            renderActions={(song) => (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    startEditComment(song)
                  }}
                  className="text-neutral-400 hover:text-neutral-200 text-xs px-2"
                  title="编辑评论"
                >
                  评论
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeSong(song.id)
                  }}
                  className="text-neutral-400 hover:text-red-400 text-xs px-2"
                  title="从该 Tag 移除"
                >
                  移除
                </button>
              </div>
            )}
            renderBelow={(song) =>
              editingCommentId === song.id ? (
                <div className="mt-1 flex items-center gap-2 px-4 pb-2">
                  <input
                    autoFocus
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveComment(song.id)
                      if (e.key === 'Escape') setEditingCommentId(null)
                    }}
                    placeholder="填写评论"
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-white/30"
                  />
                  <button
                    onClick={() => saveComment(song.id)}
                    className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingCommentId(null)}
                    className="text-xs px-2 py-1 rounded hover:bg-white/10 text-neutral-400"
                  >
                    取消
                  </button>
                </div>
              ) : song.comment ? (
                <div className="mx-3 mb-2 mt-1 rounded-lg bg-black/30 px-3 py-1.5 text-xs text-neutral-400 whitespace-pre-wrap">
                  {song.comment}
                </div>
              ) : null
            }
          />
        )}
      </div>

      {editingSong && (
        <SongEditModal
          songId={editingSong.id}
          onClose={() => setEditingSong(null)}
          onSaved={() => {
            setEditingSong(null)
            load()
          }}
        />
      )}
      {editingTag && tag && (
        <TagEditModal
          tag={tag}
          onClose={() => setEditingTag(false)}
          onSaved={(tagType) => {
            setEditingTag(false)
            load()
            onTagTypeChanged(tagType)
          }}
          onDeleted={() => {
            setEditingTag(false)
            onDeleted()
          }}
        />
      )}
    </div>
  )
}
