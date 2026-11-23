import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)
const source = resolve('src/native-media/venas_media.mm')
const output = resolve('resources/native-media')
const binary = join(output, 'venas-media.node')
const stamp = join(output, 'build.json')
const hash = createHash('sha256').update(readFileSync(source)).update(readFileSync(new URL(import.meta.url))).digest('hex')
const identity = JSON.stringify({ hash, arch: process.arch })
if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8') === identity) process.exit(0)
const includes = [
  process.env.npm_config_nodedir && join(process.env.npm_config_nodedir, 'include/node'),
  resolve(dirname(process.execPath), '../include/node'),
  '/opt/homebrew/include/node', '/usr/local/include/node', '/usr/include/node'
].filter(Boolean)
const headers = includes.find(path => existsSync(join(path, 'node_api.h')))
if (!headers) throw new Error('找不到 Node-API 头文件；请安装 Node.js 22 和 Xcode Command Line Tools')
mkdirSync(output, { recursive: true })
const staged = binary + '.prepared'
try {
  execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks', '-dynamiclib', '-undefined', 'dynamic_lookup',
    '-arch', process.arch, '-I', headers, '-framework', 'Foundation', '-framework', 'MediaPlayer', source, '-o', staged], { stdio: 'inherit' })
  execFileSync('codesign', ['--force', '--sign', '-', staged], { stdio: 'inherit' })
  renameSync(staged, binary)
  writeFileSync(stamp, identity)
  console.log('macOS Now Playing bridge ready')
} catch (error) {
  throw new Error('构建 macOS 播放遥控模块失败；确认已安装 Xcode Command Line Tools', { cause: error })
}
