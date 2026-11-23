import { create } from 'zustand'
import type { NavigationSession, NavigationTarget, NavigationView } from '../../../shared/types'

export type NavTarget = NavigationTarget
export type ViewKey = NavigationView

/* 跨视图返回信息仅在当前运行期间保留；Append 的编辑表单由 App 在访问详情期间保留。 */
export type ReturnContext =
  | { view: 'music'; scrollTop: number; query: string }
  | { view: 'append' }

interface NavState {
  target: NavTarget | null
  returnTo: ReturnContext | null
  restoreSignal: ReturnContext | null
  navigate: (target: NavTarget, returnContext?: ReturnContext) => void
  restoreSession: (session: NavigationSession) => void
  openRoot: (view: ViewKey) => void
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
  navigate: (target, returnContext) => {
    const view: ViewKey = target.view === 'tagType' ? 'tag' : target.view
    set({ target, returnTo: returnContext ?? get().returnTo, restoreSignal: null })
    persistNavigation({ view, target })
  },
  restoreSession: (session) => set({ target: session.target, returnTo: null, restoreSignal: null }),
  openRoot: (view) => {
    set({ target: null, returnTo: null, restoreSignal: null })
    persistNavigation({ view, target: null })
  },
  clearTarget: () => set({ target: null }),
  requestReturn: () => {
    const ret = get().returnTo
    if (!ret) return false
    set({ target: null, restoreSignal: ret, returnTo: null })
    persistNavigation({ view: ret.view, target: null })
    return true
  },
  clearRestoreSignal: () => set({ restoreSignal: null })
}))

/* 导航持久化不是当前交互的阻塞条件；IPC 失败时静默处理，避免产生未处理 Promise。 */
function persistNavigation(session: NavigationSession): void {
  void window.api.navigation.saveSession(session).catch(() => undefined)
}
