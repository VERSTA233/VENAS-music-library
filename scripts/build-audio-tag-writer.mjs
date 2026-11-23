import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

// 构建机需要 TagLib 2.x；生成物随应用分发，运行机器不需要 TagLib / Homebrew。
const output = resolve('resources/audio-tags')
const source = resolve('scripts/audio-tag-writer.cpp')
const binary = join(output, process.platform === 'win32' ? 'venas-tag-writer.exe' : 'venas-tag-writer')
const stamp = join(output, 'build.json')
const platform = `${process.platform}-${process.arch}`
if (existsSync(stamp) && existsSync(binary)) {
  const built = JSON.parse(readFileSync(stamp, 'utf8'))
  if (built.platform === platform && built.sourceMtime === statSync(source).mtimeMs && built.scriptMtime === statSync(new URL(import.meta.url)).mtimeMs) {
    try { execFileSync(binary, ['--version'], { stdio: 'pipe' }); process.exit(0) } catch { /* rebuild */ }
  }
}
mkdirSync(output, { recursive: true })
let flags
try {
  flags = execFileSync('pkg-config', [process.platform === 'win32' ? '--static' : '--libs', '--cflags', ...(process.platform === 'win32' ? ['--libs'] : []), 'taglib'], { encoding: 'utf8' }).trim().split(/\s+/)
} catch {
  try { flags = execFileSync('taglib-config', ['--cflags', '--libs'], { encoding: 'utf8' }).trim().split(/\s+/) }
  catch { throw new Error('构建标签写入器需要 TagLib 2.x 和 C++17 编译器。macOS: brew install taglib pkg-config；Windows: 使用 MSYS2 UCRT64 安装 taglib、pkgconf、gcc。') }
}
execFileSync(process.env.CXX || 'c++', ['-std=c++17', '-O2', source, ...flags, ...(process.platform === 'win32' ? ['-lshell32'] : []), '-o', binary], { stdio: 'inherit' })
if (process.platform === 'darwin') {
  const dependencies = execFileSync('otool', ['-L', binary], { encoding: 'utf8' }).split('\n').slice(1)
    .map(line => line.trim().split(' ')[0]).filter(path => path && !path.startsWith('/usr/lib/') && !path.startsWith('/System/'))
  for (const dependency of dependencies) {
    if (!basename(dependency).startsWith('libtag.')) throw new Error(`未处理的原生依赖：${dependency}`)
    const destination = join(output, basename(dependency))
    if (existsSync(destination)) chmodSync(destination, 0o644)
    copyFileSync(dependency, destination)
    chmodSync(destination, 0o644)
    execFileSync('install_name_tool', ['-id', `@loader_path/${basename(dependency)}`, destination])
    execFileSync('install_name_tool', ['-change', dependency, `@loader_path/${basename(dependency)}`, binary])
    // 非系统传递依赖必须显式处理，不能意外引用构建机的 Homebrew 目录。
    const indirect = execFileSync('otool', ['-L', destination], { encoding: 'utf8' }).split('\n').slice(2)
      .map(line => line.trim().split(' ')[0]).filter(path => path && !path.startsWith('/usr/lib/') && !path.startsWith('/System/'))
    if (indirect.length) throw new Error(`TagLib 含未打包的依赖：${indirect.join(', ')}`)
    execFileSync('codesign', ['--force', '--sign', '-', destination])
  }
  execFileSync('codesign', ['--force', '--sign', '-', binary])
} else if (process.platform === 'win32') {
  // MSYS2 的共享库与 GCC 运行库一起随程序分发；只复制实际依赖。
  const pending = [binary], copied = new Set()
  while (pending.length) {
    const dependencies = execFileSync('ldd', [pending.pop()], { encoding: 'utf8' })
    for (const match of dependencies.matchAll(/=>\s+(\/\S+\.dll)/gi)) {
      const path = match[1]
      if (/\/windows\//i.test(path) || copied.has(basename(path))) continue
      copied.add(basename(path))
      const native = execFileSync('cygpath', ['-w', path], { encoding: 'utf8' }).trim()
      const destination = join(output, basename(path))
      if (existsSync(destination)) chmodSync(destination, 0o644)
      copyFileSync(native, destination); pending.push(destination)
    }
  }
}
execFileSync(binary, ['--version'], { stdio: 'inherit' })
// 保留第三方许可证；TagLib 动态链接，原库可被用户替换。
let prefix
try { prefix = execFileSync('pkg-config', ['--variable=prefix', 'taglib'], { encoding: 'utf8' }).trim() }
catch { prefix = execFileSync('taglib-config', ['--prefix'], { encoding: 'utf8' }).trim() }
for (const license of ['COPYING.LGPL', 'COPYING.MPL']) {
  const candidates = [join(prefix, license), join(prefix, 'share/licenses/taglib', license), join(prefix, 'share/doc/taglib', license)]
  const found = candidates.find(existsSync)
  if (!found) throw new Error(`未找到 TagLib 许可证 ${license}，请放入 ${join(prefix, 'share/licenses/taglib')} 后重试`)
  const destination = join(output, license)
  if (existsSync(destination)) chmodSync(destination, 0o644)
  copyFileSync(found, destination)
}
// 仅构建缓存，不是用户数据。
const { writeFileSync } = await import('node:fs')
writeFileSync(join(output, 'NOTICE.txt'), 'TagLib 2.x (https://taglib.org/), dual LGPL/MPL license. Unmodified TagLib is dynamically linked. Source: https://github.com/taglib/taglib\nVENAS helper source: scripts/audio-tag-writer.cpp\n')
writeFileSync(stamp, JSON.stringify({ platform, sourceMtime: statSync(source).mtimeMs, scriptMtime: statSync(new URL(import.meta.url)).mtimeMs }))
