import { useEffect, useState } from 'react'
import { Disc3, FolderInput, LibraryBig, Music2, Settings, Tags, UsersRound } from 'lucide-react'
import type { PlaybackSession } from '../../shared/types'
import AppendView from './views/AppendView'
import MusicView from './views/MusicView'
import ArtistView from './views/ArtistView'
import AlbumView from './views/AlbumView'
import TagView from './views/TagView'
import SettingsView from './views/SettingsView'
import BottomPlayerBar from './components/BottomPlayerBar'
import FullPlayer from './components/FullPlayer'
import { usePlayerStore } from './stores/playerStore'
import { useNavStore, type NavTarget, type ViewKey } from './stores/navStore'
import { useLibraryStore } from './stores/libraryStore'

/*
 * 正在输入时（文本框/文本域/可编辑元素聚焦）不拦截空格，避免打字打出空格时被误判为播放/暂停快捷键。
 * range/checkbox 等非文字输入控件排除在外——否则拖完进度条后它仍持有焦点，会导致空格被这些控件
 * 自己的默认行为吞掉（比如再次触发滑块），而不是触发全局的播放/暂停快捷键。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA') return true
  if (target.tagName === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes(type)
  }
  return false
}

/*
 * 应用外壳：左侧边栏（第一区域"文件空间" Append/Music，第二区域"基础分类" Artist/Album，
 * 标签引擎等第三区域延后实现）+ 主内容区 + 底部播放条。
 */
export default function App(): React.JSX.Element {
  const [view, setView] = useState<ViewKey | null>(null)
  const [viewEpoch, setViewEpoch] = useState(0)
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const navTarget = useNavStore((s) => s.target)
  const restoreSignal = useNavStore((s) => s.restoreSignal)

  useEffect(() => {
    let disposed = false
    window.api.navigation.getSession()
      .then((session) => {
        if (disposed) return
        setView(session.view)
        useNavStore.getState().restoreSession(session)
      })
      .catch(() => {
        if (!disposed) setView('music')
      })
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    let restored = false
    let changedBeforeRestore = false
    let applyingRestore = false
    let disposed = false
    let saveTimer: number | null = null

    function sessionFromState(): PlaybackSession | null {
      const state = usePlayerStore.getState()
      if (state.currentIndex == null || state.queue.length === 0) return null
      return {
        queue: state.queue,
        currentIndex: state.currentIndex,
        currentTime: state.currentTime,
        playbackMode: state.playbackMode,
        shuffleOrder: state.shuffleOrder
      }
    }

    function saveNow(): void {
      if (!restored) return
      if (saveTimer != null) {
        window.clearTimeout(saveTimer)
        saveTimer = null
      }
      window.api.playback.saveSession(sessionFromState()).catch(() => undefined)
    }

    const unsubscribe = usePlayerStore.subscribe(() => {
      if (!restored) {
        if (!applyingRestore) changedBeforeRestore = true
        return
      }
      if (saveTimer != null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(saveNow, 800)
    })

    window.api.playback.getSession().then((session) => {
      if (disposed) return
      if (session && !changedBeforeRestore) {
        applyingRestore = true
        usePlayerStore.getState().restoreSession(session)
        applyingRestore = false
      }
      restored = true
      if (changedBeforeRestore) saveNow()
    }).catch(() => {
      if (disposed) return
      restored = true
    })
    window.addEventListener('pagehide', saveNow)
    return () => {
      disposed = true
      window.removeEventListener('pagehide', saveNow)
      saveNow()
      unsubscribe()
    }
  }, [])

  /* 歌曲信息弹窗里点击艺术家/专辑/厂牌链接时，切到对应的第一区域视图，具体二级详情页由该视图自己消费 navTarget 并跳转 */
  useEffect(() => {
    if (!navTarget) return
    setView(navTarget.view === 'tagType' ? 'tag' : navTarget.view)
  }, [navTarget])

  /* 详情页返回按钮触发跨视图返回时，把顶层视图切回记录的目标视图（目前只有 Music） */
  useEffect(() => {
    if (!restoreSignal) return
    setView(restoreSignal.view)
  }, [restoreSignal])

  /* 全局快捷键：空格键切换播放/暂停（当前没有播放曲目时 togglePlay 内部本身就是空操作） */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code === 'Escape' && fullPlayerOpen) {
        e.preventDefault()
        setFullPlayerOpen(false)
        return
      }
      if (e.code !== 'Space' || isTypingTarget(e.target)) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, fullPlayerOpen])

  function handleFullPlayerNavigate(target: Extract<NavTarget, { view: 'artist' | 'album' }>): void {
    setView(target.view)
    useNavStore.getState().navigate(target)
    setFullPlayerOpen(false)
  }

  function handleSidebarNavigation(nextView: ViewKey): void {
    /* 侧边栏代表重新进入栏目：丢弃跨页返回栈及详情层级，并清空 Music 搜索。 */
    void useLibraryStore.getState().setQuery('')
    useNavStore.getState().openRoot(nextView)
    setView(nextView)
    setViewEpoch((value) => value + 1)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0e0e10]">
      <div className="flex flex-1 min-h-0">
        <aside className="relative flex w-60 shrink-0 flex-col border-r border-white/[0.08] bg-[#151518]/88 px-3 pb-5 pt-[3.75rem] backdrop-blur-2xl">
          <div className="window-drag-region absolute inset-x-0 top-0 h-12" aria-hidden="true" />
          <div className="mb-7 flex items-center gap-2.5 px-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black shadow-sm"><Music2 size={17} strokeWidth={2.2} /></div>
            <span className="text-sm font-semibold text-white">VENAS</span>
          </div>

          <SidebarSection label="音乐库">
            <NavItem label="Append" icon={<FolderInput size={17} />} active={view === 'append'} onClick={() => handleSidebarNavigation('append')} />
            <NavItem label="Music" icon={<LibraryBig size={17} />} active={view === 'music'} onClick={() => handleSidebarNavigation('music')} />
          </SidebarSection>

          <SidebarSection label="分类">
            <NavItem label="Artist" icon={<UsersRound size={17} />} active={view === 'artist'} onClick={() => handleSidebarNavigation('artist')} />
            <NavItem label="Album" icon={<Disc3 size={17} />} active={view === 'album'} onClick={() => handleSidebarNavigation('album')} />
            <NavItem label="Tag" icon={<Tags size={17} />} active={view === 'tag'} onClick={() => handleSidebarNavigation('tag')} />
          </SidebarSection>

          <div className="mt-auto border-t border-white/[0.08] pt-4">
            <NavItem label="设置" icon={<Settings size={17} />} active={view === 'settings'} onClick={() => handleSidebarNavigation('settings')} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-[#101012]">
          {view === 'append' && <AppendView key={`append-${viewEpoch}`} />}
          {view === 'music' && <MusicView key={`music-${viewEpoch}`} />}
          {view === 'artist' && <ArtistView key={`artist-${viewEpoch}`} />}
          {view === 'album' && <AlbumView key={`album-${viewEpoch}`} />}
          {view === 'tag' && <TagView key={`tag-${viewEpoch}`} />}
          {view === 'settings' && <SettingsView key={`settings-${viewEpoch}`} />}
        </main>
      </div>

      <BottomPlayerBar hidden={fullPlayerOpen} onOpenFullPlayer={() => setFullPlayerOpen(true)} />
      <FullPlayer open={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} onNavigate={handleFullPlayerNavigate} />
    </div>
  )
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="mb-6"><div className="mb-2 px-3 text-[11px] font-medium text-neutral-600">{label}</div><div className="space-y-0.5">{children}</div></section>
}

function NavItem({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition active:scale-[0.98] ${
        active ? 'bg-white/[0.13] text-white shadow-sm' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <span className={active ? 'text-white' : 'text-neutral-500'}>{icon}</span>
      {label}
    </button>
  )
}
