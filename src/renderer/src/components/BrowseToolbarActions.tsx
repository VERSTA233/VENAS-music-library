import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

interface BrowseToolbarActionsProps {
  query: string
  onQueryChange: (query: string) => void
  placeholder: string
  searchLabel: string
  sortControl?: ReactNode
  count: number
  countUnit: string
}

/* 分类第一层视图共用的搜索与数量展示；需要排序的视图可额外传入排序控件。 */
export default function BrowseToolbarActions({
  query,
  onQueryChange,
  placeholder,
  searchLabel,
  sortControl,
  count,
  countUnit
}: BrowseToolbarActionsProps): React.JSX.Element {
  return (
    <div className="ml-auto flex min-w-0 items-center gap-3">
      <label className="relative flex h-8 w-56 min-w-0 items-center rounded-lg bg-white/[0.06] text-neutral-400 transition focus-within:bg-white/[0.1]">
        <Search size={15} className="pointer-events-none absolute left-2.5 text-neutral-600" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="h-full w-full min-w-0 bg-transparent py-1 pl-8 pr-7 text-xs text-neutral-200 placeholder:text-neutral-600"
          aria-label={searchLabel}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition hover:bg-white/10 hover:text-white"
            title="清空搜索"
            aria-label="清空搜索"
          >
            <X size={14} />
          </button>
        )}
      </label>
      {sortControl ?? null}
      <span className="shrink-0 text-xs tabular-nums text-neutral-500">{count} {countUnit}</span>
    </div>
  )
}
