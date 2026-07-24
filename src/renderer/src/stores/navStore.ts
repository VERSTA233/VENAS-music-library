import { create } from 'zustand'

export type NavTarget =
  | { view: 'artist'; id: number; isLabel: boolean }
  | { view: 'album'; id: number }

/* 从 Music 列表跳转到艺术家/专辑详情页时，记录的"如何跳回去"上下文（目前只有滚动位置） */
export interface ReturnContext {
  view: 'music'
  scrollTop: number
}

interface NavState {
  target: NavTarget | null
  returnTo: ReturnContext | null
  restoreSignal: ReturnContext | null
  navigate: (target: NavTarget, returnContext?: ReturnContext) => void
  clearTarget: () => void
  /* 详情页返回按钮调用：若存在入口记录的 returnTo，则触发跨视图返回并清空，返回 true；
     否则不做任何事，返回 false，由调用方自行处理为"返回上一层网格" */
  requestReturn: () => boolean
  clearRestoreSignal: () => void
}

export const useNavStore = create<NavState>((set, get) => ({
  target: null,
  returnTo: null,
  restoreSignal: null,
  navigate: (target, returnContext) => set({ target, returnTo: returnContext ?? null }),
  clearTarget: () => set({ target: null }),
  requestReturn: () => {
    const ret = get().returnTo
    if (!ret) return false
    set({ restoreSignal: ret, returnTo: null })
    return true
  },
  clearRestoreSignal: () => set({ restoreSignal: null })
}))
