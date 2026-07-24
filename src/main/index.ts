import { app, shell, BrowserWindow, dialog, protocol } from 'electron'
import { join, extname } from 'node:path'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { settings } from './settings'
import { initLibrary } from './library/init'
import { runDailyBackup } from './library/backup'
import { registerIpcHandlers } from './ipc'
import type { LibraryPaths } from './library/paths'

let libraryPaths: LibraryPaths | null = null

/*
 * 自定义协议承载本地音频播放：渲染进程是 http://localhost（dev）或 file://（生产）页面，
 * Chromium 不允许网页/沙盒上下文直接用 file:// 播放任意本地文件，必须走注册过的特权协议。
 * URL 形如 venas-media://music/<encoded file name> 或 venas-media://append/<encoded file name>。
 * Range 支持必须自己实现：net.fetch 转发到 file:// 目标时并不会真正处理 Range 头
 * （底层对本地文件协议直接忽略 Range，永远返回整个文件的 200），导致 <audio> 认为该资源不可 seek，
 * 拖动进度条会整个重新请求、从头播放。这里手动解析 Range，用 fs 按字节区间读取并返回 206。
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'venas-media', privileges: { standard: true, stream: true, supportFetchAPI: true } }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0f',
    webPreferences: {
      /* package.json 为 "type": "module"，electron-vite 会把 preload 输出为 .mjs，扩展名必须对上 */
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ape': 'audio/x-ape'
}

/* 注册 venas-media:// 协议：host 区分 music/append 两个子目录，路径部分是 URL 编码后的文件名（不含子目录层级） */
function registerMediaProtocol(paths: LibraryPaths): void {
  protocol.handle('venas-media', async (request) => {
    const url = new URL(request.url)
    const base = url.hostname === 'append' ? paths.append : paths.music
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const filePath = join(base, fileName)
    const mimeType = AUDIO_MIME_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream'

    let fileSize: number
    try {
      fileSize = statSync(filePath).size
    } catch {
      return new Response(null, { status: 404 })
    }

    const rangeHeader = request.headers.get('range')
    if (!rangeHeader) {
      // 没有 Range 头（比如首次加载探测 duration）：返回整个文件
      const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': mimeType, 'Content-Length': String(fileSize), 'Accept-Ranges': 'bytes' }
      })
    }

    // 形如 "bytes=1234-" 或 "bytes=1234-5678"，结束值缺省时取到文件末尾
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
    if (!match) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } })
    }
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : fileSize - 1
    if (start >= fileSize || end >= fileSize || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } })
    }

    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
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
  registerIpcHandlers(libraryPaths)
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
