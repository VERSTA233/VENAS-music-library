import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/* 只替换内容，不移动位置；快速切换时始终进入最新内容，离场链接不再响应点击。 */
export default function PlaybackFade({ contentKey, className, children }: {
  contentKey: string
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const reducedMotion = useReducedMotion()
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div key={contentKey} className={className}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: reducedMotion ? 0.06 : 0.12 } }}
        transition={{ duration: reducedMotion ? 0.1 : 0.24, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
