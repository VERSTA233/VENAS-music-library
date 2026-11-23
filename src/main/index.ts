import { app, shell, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { settings } from './settings'
import { initLibrary } from './library/init'
import { runDailyBackup } from './library/backup'
import { repairMissingOggDurations } from './library/repairDurations'
import { getDatabase } from './db'
import { registerIpcHandlers } from './ipc'
import { colors } from '../shared/colors'
import type { LibraryPaths } from './library/paths'
import { configureAudioOutput } from './audioOutput'
import { broadcastToWindows } from './windowBroadcast'
import { registerMediaProtocol, registerMediaScheme } from './mediaProtocol'
import { startNowPlaying } from './nowPlaying'
import type { NowPlayingState } from '../shared/types'

// Chromium 特性必须在 app ready / 音频服务启动前设置。
const audioOutputRuntime = configureAudioOutput(app.commandLine, process.platform, settings.get('macAudioBackend'))

let libraryPaths: LibraryPaths | null = null
let mainWindow: BrowserWindow | null = null
let nowPlaying: ReturnType<typeof startNowPlaying> | null = null

registerMediaScheme()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    /* 让 Web 内容延伸到交通灯区域，标题栏与侧栏/内容区使用同一套深色材质。 */
    titleBarStyle: 'hiddenInset',
    backgroundColor: colors.app,
    webPreferences: {
      /* package.json 为 "type": "module"，electron-vite 会把 preload 输出为 .mjs，扩展名必须对上 */
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      /* 最小化后仍需及时准备后续曲目并同步播放队列。 */
      backgroundThrottling: false
    }
  })
  mainWindow = window
  window.webContents.on('did-start-loading', () => nowPlaying?.update(null))
  window.on('closed', () => {
    nowPlaying?.update(null)
    if (mainWindow === window) mainWindow = null
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* 首次启动：若未设置音乐目录/系统目录，弹出文件夹选择对话框；两者默认相同，之后可在侧边栏分别更改 */
async function ensureLibraryRoot(): Promise<{ musicRoot: string; systemRoot: string } | null> {
  /* 兼容旧版本单一 libraryRoot 配置：迁移为 musicRoot + systemRoot 各自一份 */
  const legacyRoot = (settings.store as unknown as { libraryRoot?: string }).libraryRoot
  if (legacyRoot && !settings.get('musicRoot')) {
    settings.set('musicRoot', legacyRoot)
    settings.set('systemRoot', legacyRoot)
  }

  const existingMusic = settings.get('musicRoot')
  const existingSystem = settings.get('systemRoot')
  if (existingMusic && existingSystem) return { musicRoot: existingMusic, systemRoot: existingSystem }

  const result = await dialog.showOpenDialog({
    title: '请选择音乐库根目录',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const root = result.filePaths[0]
  settings.set('musicRoot', root)
  settings.set('systemRoot', root)
  return { musicRoot: root, systemRoot: root }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.venas.app')
  nowPlaying = startNowPlaying((command) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('playback:remoteCommand', command)
  })
  ipcMain.on('playback:updateNowPlaying', (event, state: NowPlayingState | null) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) return
    if (state === null) { nowPlaying?.update(null); return }
    if (!state || typeof state.title !== 'string' || typeof state.artist !== 'string'
      || typeof state.playing !== 'boolean' || !Number.isFinite(state.duration) || !Number.isFinite(state.position)) return
    nowPlaying?.update(state)
  })

  let systemSuspended = false
  const publishPowerState = (suspended: boolean): void => {
    systemSuspended = suspended
    broadcastToWindows('playback:systemSuspended', suspended)
  }
  // 独立于数据库维护，渲染进程重载或初始化期间也能取得当前状态。
  ipcMain.handle('playback:getSystemSuspended', () => systemSuspended)
  powerMonitor.on('suspend', () => publishPowerState(true))
  powerMonitor.on('resume', () => publishPowerState(false))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const root = await ensureLibraryRoot()
  if (!root) {
    app.quit()
    return
  }

  libraryPaths = initLibrary(root.musicRoot, root.systemRoot)
  runDailyBackup(libraryPaths)
  await repairMissingOggDurations(libraryPaths, getDatabase())
  registerIpcHandlers(libraryPaths, audioOutputRuntime)
  registerMediaProtocol(libraryPaths)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => nowPlaying?.dispose())
