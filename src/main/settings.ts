import Store from 'electron-store'
import type { NavigationSession, PlaybackSession, PlaybackVolume } from '../shared/types'

interface AppSettings {
  playbackVolume: PlaybackVolume
  gaplessEnabled: boolean
  /* 音乐目录（Append/Music 所在位置） */
  musicRoot: string | null
  /* 系统数据目录（.system 所在位置，含数据库/缓存/日志），默认与 musicRoot 相同，可分开存放 */
  systemRoot: string | null
  /* 网易云音乐下载目录；解码导入时只读取其根层文件，不扫描子文件夹。 */
  neteaseMusicRoot: string | null
  /* 最近一次播放会话；只保存播放位置和队列，不自动恢复播放声。 */
  playbackSession: PlaybackSession | null
  /* 最近所在的栏目或分类详情；搜索词和临时弹窗不持久化。 */
  navigationSession: NavigationSession
}

export const settings = new Store<AppSettings>({
  defaults: {
    playbackVolume: { volume: 1, muted: false },
    gaplessEnabled: true,
    musicRoot: null,
    systemRoot: null,
    neteaseMusicRoot: null,
    playbackSession: null,
    navigationSession: { view: 'music', target: null }
  }
})
