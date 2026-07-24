import { useEffect, useState } from 'react'
import AppendView from './views/AppendView'
import MusicView from './views/MusicView'
import ArtistView from './views/ArtistView'
import AlbumView from './views/AlbumView'
import BottomPlayerBar from './components/BottomPlayerBar'
import { usePlayerStore } from './stores/playerStore'
import { useNavStore } from './stores/navStore'

type ViewKey = 'append' | 'music' | 'artist' | 'album'

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
  const [view, setView] = useState<ViewKey>('music')
  const [musicRoot, setMusicRoot] = useState('')
  const [systemRoot, setSystemRoot] = useState('')
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const navTarget = useNavStore((s) => s.target)
  const restoreSignal = useNavStore((s) => s.restoreSignal)

  useEffect(() => {
    window.api.library.getRoots().then(({ musicRoot, systemRoot }) => {
      setMusicRoot(musicRoot)
      setSystemRoot(systemRoot)
    })
  }, [])

  /* 歌曲信息弹窗里点击艺术家/专辑/厂牌链接时，切到对应的第一区域视图，具体二级详情页由该视图自己消费 navTarget 并跳转 */
  useEffect(() => {
    if (!navTarget) return
    setView(navTarget.view)
  }, [navTarget])

  /* 详情页返回按钮触发跨视图返回时，把顶层视图切回记录的目标视图（目前只有 Music） */
  useEffect(() => {
    if (!restoreSignal) return
    setView(restoreSignal.view)
  }, [restoreSignal])

  /* 全局快捷键：空格键切换播放/暂停（当前没有播放曲目时 togglePlay 内部本身就是空操作） */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay])

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1 min-h-0">
        <aside className="w-48 border-r border-white/10 flex flex-col py-4">
          <div className="px-4 pb-2 text-xs text-neutral-600 uppercase tracking-wide">文件空间</div>
          <div className="flex flex-col gap-1">
            <NavItem label="Append" active={view === 'append'} onClick={() => setView('append')} />
            <NavItem label="Music" active={view === 'music'} onClick={() => setView('music')} />
          </div>

          <div className="px-4 pt-4 pb-2 text-xs text-neutral-600 uppercase tracking-wide">基础分类</div>
          <div className="flex flex-col gap-1">
            <NavItem label="Artist" active={view === 'artist'} onClick={() => setView('artist')} />
            <NavItem label="Album" active={view === 'album'} onClick={() => setView('album')} />
          </div>

          <div className="mt-auto px-4 pt-4 border-t border-white/10 flex flex-col gap-3">
            <div>
              <div className="text-xs text-neutral-600 mb-1">音乐目录</div>
              <div className="text-xs text-neutral-400 break-all mb-1" title={musicRoot}>
                {musicRoot}
              </div>
              <button
                onClick={() => window.api.library.changeMusicRoot()}
                className="text-xs text-neutral-400 hover:text-white underline"
              >
                更改目录
              </button>
            </div>
            <div>
              <div className="text-xs text-neutral-600 mb-1">系统目录</div>
              <div className="text-xs text-neutral-400 break-all mb-1" title={systemRoot}>
                {systemRoot}
              </div>
              <button
                onClick={() => window.api.library.changeSystemRoot()}
                className="text-xs text-neutral-400 hover:text-white underline"
              >
                更改目录
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          {view === 'append' && <AppendView />}
          {view === 'music' && <MusicView />}
          {view === 'artist' && <ArtistView />}
          {view === 'album' && <AlbumView />}
        </main>
      </div>

      <BottomPlayerBar />
    </div>
  )
}

function NavItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-left px-4 py-1.5 text-sm rounded-r-full mr-3 ${
        active ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  )
}
