import { useEffect, useState } from 'react'

interface CoverProps {
  /* 作为 useEffect 依赖的稳定 key（songId 或 fileName），用于判断是否需要重新加载，而不是依赖 load 本身（每次渲染都是新的函数引用） */
  cacheKey: string | number
  load: () => Promise<Uint8Array | null>
  className?: string
}

/* 通用封面缩略图：异步取二进制数据转成 objectURL 展示，取不到时留空白占位；卸载/切换时释放旧 URL 避免泄漏 */
export default function Cover({ cacheKey, load, className }: CoverProps): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setUrl(null)
    load().then((data) => {
      if (cancelled || !data) return
      /* lib.dom 的 BlobPart 类型不接受 SharedArrayBuffer 支持的 Uint8Array，这里转成 as BlobPart 绕过（运行时 Blob 本身接受 BufferSource） */
      objectUrl = URL.createObjectURL(new Blob([data as BlobPart]))
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  return url ? (
    <img src={url} className={className} alt="" draggable={false} />
  ) : (
    <div className={`${className} bg-white/5`} />
  )
}
