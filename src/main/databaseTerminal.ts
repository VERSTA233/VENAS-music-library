import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, isAbsolute, join, win32 } from 'node:path'
import { promisify } from 'node:util'
import type { LibraryPaths } from './library/paths'

const execFileAsync = promisify(execFile)

/* 路径作为环境数据传入，不拼进 PowerShell 源码，中文、空格及 shell 字符均原样保留。 */
export function windowsDatabaseTerminal(binary: string, database: string, env: NodeJS.ProcessEnv = process.env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  const session = Buffer.from('& $env:VENAS_SQLITE_EXE $env:VENAS_DATABASE_FILE', 'utf16le').toString('base64')
  // 由系统启动独立的交互终端，不把 Electron 的管道或空输入继承给 sqlite3。
  const launch = `Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', '${session}') -ErrorAction Stop`
  return {
    command: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launch, 'utf16le').toString('base64')],
    options: {
      windowsHide: true,
      timeout: 10000,
      env: { ...env, VENAS_SQLITE_EXE: binary, VENAS_DATABASE_FILE: database }
    }
  }
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

export async function openDatabaseTerminal(paths: LibraryPaths): Promise<void> {
  if (process.platform === 'win32') {
    let binary = join(paths.tools, 'sqlite3.exe')
    if (!isFile(binary)) {
      // 直接检查 PATH，避免 where.exe 的本地代码页输出破坏中文路径。
      const found = (process.env.PATH || process.env.Path || '').split(delimiter)
        .map(directory => directory.replace(/^"(.*)"$/, '$1')).filter(isAbsolute)
        .map(directory => join(directory, 'sqlite3.exe')).find(isFile)
      if (!found) throw new Error('找不到 sqlite3.exe，请将 Windows 版 SQLite 命令行工具放入 .system/tools，或将其目录加入 PATH。')
      binary = found
    }
    const launch = windowsDatabaseTerminal(binary, paths.dbFile)
    await execFileAsync(launch.command, launch.args, launch.options)
    return
  }
  if (process.platform !== 'darwin') throw new Error('数据库终端入口仅支持 Windows 和 macOS')
  const quotedPath = `'${paths.dbFile.replace(/'/g, "'\\''")}'`
  const command = `sqlite3 ${quotedPath}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await execFileAsync('osascript', ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "${command}"`])
}
