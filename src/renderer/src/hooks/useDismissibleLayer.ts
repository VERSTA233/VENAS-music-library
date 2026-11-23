import { useEffect, useRef, type RefObject } from 'react'

/* 弹出层共用外部点击与可选 Escape 关闭；触发器和面板可分别作为内部区域。 */
export function useDismissibleLayer(
  open: boolean,
  regions: RefObject<HTMLElement | null>[],
  onDismiss: () => void,
  closeOnEscape = false
): void {
  const latest = useRef({ regions, onDismiss })
  latest.current = { regions, onDismiss }

  useEffect(() => {
    if (!open) return
    function outsidePointer(event: PointerEvent): void {
      if (!latest.current.regions.some(region => region.current?.contains(event.target as Node))) latest.current.onDismiss()
    }
    function escape(event: KeyboardEvent): void {
      if (event.key === 'Escape') latest.current.onDismiss()
    }
    document.addEventListener('pointerdown', outsidePointer)
    if (closeOnEscape) document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outsidePointer)
      if (closeOnEscape) document.removeEventListener('keydown', escape)
    }
  }, [open, closeOnEscape])
}
