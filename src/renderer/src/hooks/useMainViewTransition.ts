import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

/* 只为主视图拍摄短暂快照，不保留离场页面的组件、订阅或弹窗。 */
export function useMainViewTransition(): (update: () => void) => void {
  const active = useRef<ViewTransition | null>(null)
  const sequence = useRef(0)

  useEffect(() => () => {
    sequence.current++
    active.current?.skipTransition()
  }, [])

  return useCallback((update: () => void) => {
    const current = ++sequence.current
    active.current?.skipTransition()
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update()
      return
    }
    const transition = document.startViewTransition(() => {
      /* 快速连续点击时，尚未提交的旧导航不能覆盖最新选择。 */
      if (current === sequence.current) flushSync(update)
    })
    active.current = transition
    void transition.finished.catch(() => undefined).finally(() => {
      if (active.current === transition) active.current = null
    })
  }, [])
}
