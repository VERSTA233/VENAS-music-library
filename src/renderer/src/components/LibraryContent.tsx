import type { ReactNode, Ref } from 'react'

interface LibraryContentProps {
  loading: boolean
  layout?: 'songs' | 'artists' | 'albums' | 'tags'
  className?: string
  scrollRef?: Ref<HTMLDivElement>
  children: ReactNode
}

/* 加载时保留列表/网格的空间节奏；数据一到就呈现，不设最短等待时间。 */
export default function LibraryContent({ loading, layout = 'songs', className = '', scrollRef, children }: LibraryContentProps): React.JSX.Element {
  return (
    <div ref={scrollRef} className={`library-content min-h-0 flex-1 overflow-y-auto ${className}`} aria-busy={loading} data-loading={loading}>
      {loading ? (
        <div role="status" aria-label="加载中" className={`library-placeholder library-placeholder-${layout}`}>
          {Array.from({ length: layout === 'artists' || layout === 'albums' ? 8 : 9 }, (_, index) => (
            <div key={index} className="library-placeholder-item" aria-hidden="true">
              <span className="library-placeholder-cover" />
              <span className="library-placeholder-copy"><span /><span /></span>
              <span className="library-placeholder-time" />
            </div>
          ))}
        </div>
      ) : children}
    </div>
  )
}
