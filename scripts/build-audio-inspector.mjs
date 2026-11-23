import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 从固定官方源码构建，避免预编译包包含 nonfree 或构建机专属动态依赖。
const version = '8.0.1'
const url = `https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n${version}`
const sourceHash = '679aa13a19415d5ddab91e580084e3ab20c963c8240001e5cbb955a97bdd81b1'
const output = resolve('resources/audio-inspect')
const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const binary = join(output, name)
const stamp = join(output, 'build.json')
const scriptHash = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')
const identity = { version, platform: process.platform, arch: process.arch, scriptHash }
if (existsSync(stamp) && existsSync(binary) && readFileSync(stamp, 'utf8') === JSON.stringify(identity)) {
  try { execFileSync(binary, ['-version'], { stdio: 'pipe' }); process.exit(0) } catch { /* rebuild */ }
}
mkdirSync(output, { recursive: true })
const archive = join(output, `ffmpeg-${version}-source.tar.gz`)
if (!existsSync(archive)) {
  if (process.env.VENAS_FFMPEG_SOURCE) copyFileSync(process.env.VENAS_FFMPEG_SOURCE, archive)
  else {
    console.log(`Downloading FFmpeg ${version} official source (first build only)…`)
    execFileSync('curl', ['--fail', '--location', '--retry', '2', '--max-time', '180', url, '-o', `${archive}.download`], { stdio: 'inherit' })
    renameSync(`${archive}.download`, archive)
  }
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sourceHash) throw new Error(`FFmpeg 源码校验失败，请删除 ${archive} 后重试`)
const directory = mkdtempSync(join(tmpdir(), 'venas-build-ffmpeg-'))
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory])
  const source = join(directory, `FFmpeg-n${version}`)
  const decoders = ['flac', 'mp3', 'mp3float', 'vorbis', 'opus', 'aac', 'aac_latm', 'alac', 'ape', 'wmav1', 'wmav2', 'wmapro', 'wmavoice', 'wmalossless', 'wavpack',
    'pcm_s8', 'pcm_u8', 'pcm_s16le', 'pcm_s16be', 'pcm_u16le', 'pcm_u16be', 'pcm_s24le', 'pcm_s24be', 'pcm_u24le', 'pcm_u24be', 'pcm_s32le', 'pcm_s32be',
    'pcm_s64le', 'pcm_s64be', 'pcm_f16le', 'pcm_f24le', 'pcm_f32le', 'pcm_f32be', 'pcm_f64le', 'pcm_f64be', 'pcm_alaw', 'pcm_mulaw', 'adpcm_ima_wav', 'adpcm_ms']
  const flags = ['--disable-autodetect', '--disable-network', '--disable-doc', '--disable-debug', '--disable-shared', '--enable-static', '--disable-x86asm',
    '--disable-programs', '--enable-ffmpeg', '--disable-everything', '--disable-avdevice', '--disable-swscale',
    '--enable-protocol=file,pipe', '--enable-demuxer=flac,mp3,wav,ogg,mov,aac,aiff,ape,asf,matroska,wv',
    '--enable-parser=flac,mpegaudio,vorbis,opus,aac,aac_latm', `--enable-decoder=${decoders.join(',')}`,
    '--enable-encoder=pcm_s8,pcm_s16le,pcm_s24le,pcm_s32le', '--enable-muxer=null,pcm_s8,pcm_s16le,pcm_s24le,pcm_s32le', '--enable-filter=abuffer,abuffersink,aresample,aformat,anull',
    ...(process.platform === 'win32' ? ['--target-os=mingw32', '--cc=gcc', '--host-cc=gcc', '--extra-ldflags=-static'] : [])]
  console.log(`Building audio inspector for ${process.platform}/${process.arch} (first build only)…`)
  try {
    execFileSync('bash', ['./configure', ...flags], { cwd: source, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 })
    execFileSync('make', ['-j', String(Math.min(8, availableParallelism())), name], { cwd: source, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    process.stderr.write(error.stdout ?? ''); process.stderr.write(error.stderr ?? '')
    throw new Error('FFmpeg 检查工具构建失败。需要 bash、make、tar、curl、C 编译器；Windows 请在 MSYS2 UCRT64 终端执行。', { cause: error })
  }
  const prepared = `${binary}.prepared`
  copyFileSync(join(source, name), prepared); chmodSync(prepared, 0o755)
  if (process.platform === 'darwin') {
    const deps = execFileSync('otool', ['-L', prepared], { encoding: 'utf8' }).split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean)
    if (deps.some(path => !path.startsWith('/usr/lib/') && !path.startsWith('/System/'))) throw new Error(`FFmpeg 含未打包的动态依赖：${deps.join(', ')}`)
    execFileSync('codesign', ['--force', '--sign', '-', prepared], { stdio: 'pipe' })
  }
  const license = execFileSync(prepared, ['-L'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (!/GNU\s+Lesser\s+General\s+Public\s+License/.test(license) || license.includes('not legally redistributable')) throw new Error('FFmpeg 许可证与精简构建预期不符，拒绝打包')
  renameSync(prepared, binary)
  copyFileSync(join(source, 'COPYING.LGPLv2.1'), join(output, 'COPYING.LGPLv2.1'))
  writeFileSync(join(output, 'NOTICE.txt'), `FFmpeg ${version}, unmodified official source; LGPL-2.1-or-later.\nSource: ${url}\nSHA-256: ${sourceHash}\nThe corresponding source archive is included alongside this notice.\nConfigure arguments: ${flags.join(' ')}\nBuild: make -j8 ${name}\nNo GPL/nonfree components or external codec libraries are enabled. This separate executable is used only for read-only audio inspection.\n`)
  writeFileSync(stamp, JSON.stringify(identity))
  console.log(`Audio inspector ready: ${binary}`)
} finally { rmSync(directory, { recursive: true, force: true }) }
