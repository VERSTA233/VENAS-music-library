import Store from 'electron-store'

interface AppSettings {
  /* 音乐目录（Append/Music 所在位置） */
  musicRoot: string | null
  /* 系统数据目录（.system 所在位置，含数据库/缓存/日志），默认与 musicRoot 相同，可分开存放 */
  systemRoot: string | null
}

export const settings = new Store<AppSettings>({
  defaults: {
    musicRoot: null,
    systemRoot: null
  }
})
