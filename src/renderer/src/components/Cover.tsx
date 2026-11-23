import { useCoverUrl } from '../hooks/useCoverUrl'
import { useThumbnailCoverUrl } from '../hooks/useThumbnailCoverUrl'
import type { CoverResource } from '../../../shared/types'

interface CoverProps {
  /* 作为 useEffect 依赖的稳定 key（songId 或 fileName），用于判断是否需要重新加载，而不是依赖 load 本身（每次渲染都是新的函数引用） */
  cacheKey: string | number
  load: () => Promise<Uint8Array | null>
  className?: string
  resource?: CoverResource
  thumbnailKey?: string
}

/* 非列表封面仍保持即时读取；长列表只加载视窗附近的封面并有界复用。 */
export default function Cover(props: CoverProps): React.JSX.Element {
  return props.thumbnailKey ? <DeferredCover {...props} thumbnailKey={props.thumbnailKey} /> : <ImmediateCover {...props} />
}

function ImmediateCover({ cacheKey, load, className, resource }: CoverProps): React.JSX.Element {
  const url = useCoverUrl(cacheKey, load, resource)

  return url ? (
    <img src={url} className={className} alt="" draggable={false} />
  ) : (
    <div className={`${className} bg-white/5`} />
  )
}

function DeferredCover({ thumbnailKey, load, className, resource }: CoverProps & { thumbnailKey: string }): React.JSX.Element {
  const { url, setElement } = useThumbnailCoverUrl(thumbnailKey, load, resource)
  return (
    <div ref={setElement} className={`${className ?? ''} overflow-hidden bg-white/5`}>
      {url && <img src={url} className="h-full w-full object-cover" alt="" draggable={false} decoding="async" />}
    </div>
  )
}
