import type Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { setPriority } from 'node:os'
import type { AudioIntegrityIssue, AudioIntegrityProgress, AudioIntegrityProgressUpdate } from '../../shared/types'
import type { LibraryPaths } from './paths'
import { audioFileOperations } from './audioFileOperations'
import { hashAudioFile, isSameAudioFile } from './audioFileHash'
import { hasM4aCoverWithValidAudioTiming } from './m4aCoverTiming'

const RULES_VERSION = '3'
interface Song { id: number; title: string; file_name: string }
interface State { status: string; file_hash: string | null; scanner_version: string | null; error_info: string | null }

/* 完整性检查结果只服务于当前应用运行周期，启动时由主进程调用清理。 */
export function clearAudioIntegrityScanState(database: Database.Database): void {
  database.prepare('DELETE FROM audio_integrity_scan_state').run()
}

interface FlacChecksum { md5: string; samples: number; channels: number; bytesPerSample: number; format: string }

// 原生 FLAC 的首块必须是 34 字节 STREAMINFO；全零 MD5 或未知采样总数不能作为通过依据。
async function readFlacChecksum(source: string): Promise<FlacChecksum | null> {
  const file = await open(source, 'r')
  try {
    const header = Buffer.alloc(42)
    let offset = 0
    while (offset < header.length) {
      const { bytesRead } = await file.read(header, offset, header.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset < 4 || header.toString('ascii', 0, 4) !== 'fLaC') return null
    if (offset < 42 || (header[4] & 0x7f) !== 0 || header.readUIntBE(5, 3) !== 34) throw new Error('FLAC STREAMINFO 不完整或无效')
    const packed = header.readBigUInt64BE(18)
    const bits = Number((packed >> 36n) & 31n) + 1
    const samples = Number(packed & 0xfffffffffn)
    const md5 = header.subarray(26, 42).toString('hex')
    // 非整字节位深须额外还原样本有效位；暂时沿用完整解码诊断，不能误判校验通过。
    if (![8, 16, 24, 32].includes(bits) || samples === 0 || /^0+$/.test(md5)) return null
    return { md5, samples, channels: Number((packed >> 41n) & 7n) + 1, bytesPerSample: bits / 8,
      format: bits === 8 ? 's8' : `s${bits}le` }
  } finally { await file.close() }
}

// 收集完整解码的诊断；限制内存占用但始终排空 stderr，避免子进程阻塞。
function runAudioDecoder(binary: string, args: string[], signal: AbortSignal, pcm = false): Promise<{
  diagnostics: string; code: number; output: string; pcmMd5?: string; pcmBytes: number
}> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('检查已停止')); return }
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    if (child.pid) { try { setPriority(child.pid, 10) } catch { /* 无权限降低优先级时仍可检查。 */ } }
    const lines = new Set<string>()
    let pending = '', timedOut = false, omitted = false, output = '', coverProbeSuggestion = false
    const pcmHash = pcm ? createHash('md5') : null
    let pcmBytes = 0
    // 流式计算，不保存解码后的整首音频，也不生成临时 PCM 文件。
    child.stdout.on('data', (chunk: Buffer) => {
      if (pcmHash) { pcmHash.update(chunk); pcmBytes += chunk.length }
      else output = (output + chunk.toString('utf8')).slice(0, 4000)
    })
    const collect = (line: string): void => {
      const value = line.replace(/0x[\da-f]+/gi, '…').trim()
      if (!value) return
      // WAV 等容器可能未声明声道布局；推断 mono/stereo 是正常解码行为。
      if (/^(?:\[[^\]]+\]\s*)?Guessed Channel Layout(?: for Input Stream #\d+\.\d+)?\s*:/i.test(value)) return
      // 精简工具不解码内嵌图片；忽略图片尺寸探测提示，保留所有音频流诊断。
      if (/Could not find codec parameters for stream \d+ \(Video:/i.test(value)) { coverProbeSuggestion = true; return }
      if (coverProbeSuggestion && /^Consider increasing the value for the /i.test(value)) { coverProbeSuggestion = false; return }
      coverProbeSuggestion = false
      if (lines.size < 40) lines.add(value.slice(0, 1000))
      else if (!lines.has(value)) omitted = true
    }
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const parts = (pending + chunk).split(/\r?\n|\r/)
      pending = parts.pop()!.slice(-4000)
      parts.forEach(collect)
    })
    const stop = (): void => { child.kill('SIGKILL') }
    signal.addEventListener('abort', stop, { once: true })
    const timeout = setTimeout(() => { timedOut = true; stop() }, 10 * 60 * 1000)
    child.once('error', error => { clearTimeout(timeout); signal.removeEventListener('abort', stop); reject(new Error(`无法运行音频检查工具：${error.message}`)) })
    child.once('close', (code, exitSignal) => {
      clearTimeout(timeout); signal.removeEventListener('abort', stop)
      if (signal.aborted) { reject(new Error('检查已停止')); return }
      if (timedOut || exitSignal) { reject(new Error(timedOut ? '解码超过 10 分钟，检查未完成，请重试' : `解码器异常退出 (${exitSignal})`)); return }
      collect(pending)
      if (omitted) lines.add('重复或过多诊断已折叠')
      resolve({ diagnostics: [...lines].join('\n'), code: code ?? -1, output, pcmMd5: pcmHash?.digest('hex'), pcmBytes })
    })
  })
}

export class AudioIntegrityScanner {
  private revision = 0
  private current: Omit<AudioIntegrityProgress, 'issues'> = {
    revision: 0, status: 'idle', phase: 'hashing', total: 0, completed: 0,
    scanned: 0, skipped: 0, failed: 0, currentSong: null, error: null
  }
  private abort = new AbortController()
  completion: Promise<void> = Promise.resolve()

  constructor(
    private readonly paths: LibraryPaths,
    private readonly database: () => Database.Database,
    private readonly binary: string,
    private readonly publish: (progress: AudioIntegrityProgressUpdate) => void,
    private readonly runLibraryOperation: (operation: () => Promise<void>) => Promise<void> = operation => operation()
  ) {}

  private issues(): AudioIntegrityIssue[] {
    return this.database().prepare<[], AudioIntegrityIssue>(`SELECT s.id AS songId, s.title, s.file_name AS fileName,
      CASE WHEN c.status = 'problem' THEN 'problem' ELSE 'failed' END AS kind, c.error_info AS message
      FROM audio_integrity_scan_state c JOIN songs s ON s.id = c.song_id
      WHERE c.error_info IS NOT NULL ORDER BY s.id`).all()
  }

  get progress(): AudioIntegrityProgress {
    return structuredClone({ ...this.current, issues: this.issues() })
  }
  get running(): boolean { return this.current.status === 'running' || this.current.status === 'cancelling' }
  private update(patch: Partial<Omit<AudioIntegrityProgress, 'issues'>>, issueChanges: AudioIntegrityProgressUpdate['issueChanges'] = []): void {
    this.current = { ...this.current, ...patch, revision: ++this.revision }
    this.publish(structuredClone({ ...this.current, issueChanges }))
  }

  start(songIds?: number[]): AudioIntegrityProgress {
    if (this.running) return this.progress
    const ids = songIds ? [...new Set(songIds)] : this.database().prepare<[], { id: number }>('SELECT id FROM songs ORDER BY id').all().map(song => song.id)
    this.abort = new AbortController()
    this.update({ status: 'running', phase: 'hashing', total: ids.length, completed: 0, scanned: 0, skipped: 0, failed: 0, currentSong: null, error: null })
    this.completion = this.runLibraryOperation(() => this.execute(ids)).catch(error => {
      this.update({ status: this.abort.signal.aborted ? 'cancelled' : 'failed', currentSong: null, error: this.abort.signal.aborted ? null : String(error) })
    })
    return this.progress
  }

  cancel(): AudioIntegrityProgress {
    if (this.running) { this.update({ status: 'cancelling' }); this.abort.abort() }
    return this.progress
  }

  private async execute(ids: number[]): Promise<void> {
    // 先验证工具，安装/权限问题应报告为任务错误，不能把全库歌曲误报为损坏。
    const probe = await runAudioDecoder(this.binary, ['-version'], this.abort.signal)
    if (probe.code !== 0) throw new Error(`音频检查工具不可用：${probe.diagnostics}`)
    // 捆绑二进制的版本随包版本更新；规则更改时也使旧记录失效。
    const version = `${RULES_VERSION}:${createHash('sha256').update(probe.output).digest('hex')}`
    for (const id of ids) {
      if (this.abort.signal.aborted) break
      await audioFileOperations.run(() => this.scanSong(id, version))
    }
    this.update({ status: this.abort.signal.aborted ? 'cancelled' : 'completed', currentSong: null })
  }

  private async scanSong(songId: number, version: string): Promise<void> {
    if (this.abort.signal.aborted) return
    const db = this.database()
    const song = db.prepare<[number], Song>('SELECT id, title, file_name FROM songs WHERE id = ?').get(songId)
    if (!song) {
      this.update({ completed: this.current.completed + 1, skipped: this.current.skipped + 1 }, [{ songId, issue: null }])
      return
    }
    this.update({ phase: 'hashing', currentSong: { songId, title: song.title, fileName: song.file_name } })
    const saved = db.prepare<[number], State>('SELECT * FROM audio_integrity_scan_state WHERE song_id = ?').get(songId)
    let hash: string | null = null
    const issueChanges: AudioIntegrityProgressUpdate['issueChanges'] = []
    const save = (status: string, message: string | null): void => {
      db.prepare(`INSERT INTO audio_integrity_scan_state (song_id, status, file_hash, scanner_version, error_info)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET status=excluded.status,
        file_hash=excluded.file_hash, scanner_version=excluded.scanner_version, error_info=excluded.error_info`)
        .run(songId, status, hash, version, message)
      if (status !== 'scanning' && (message || saved?.error_info)) {
        issueChanges.push({ songId, issue: message ? {
          songId, title: song.title, fileName: song.file_name, kind: status === 'problem' ? 'problem' : 'failed', message
        } : null })
      }
    }
    try {
      if (basename(song.file_name) !== song.file_name || /[/\\]/.test(song.file_name)) throw new Error('音频文件名不合法')
      const source = join(this.paths.music, song.file_name)
      const before = await lstat(source)
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('音频路径不是普通文件')
      hash = await hashAudioFile(source, this.abort.signal)
      if (!isSameAudioFile(before, await lstat(source))) throw new Error('检查期间文件已改变，请重新扫描')
      // 正常文件可以复用结果；问题文件每次新扫描都必须重试，避免一次性的解码器 / 文件状态异常被永久缓存。
      if (saved?.status === 'ok' && saved.file_hash === hash && saved.scanner_version === version) {
        this.update({ completed: this.current.completed + 1, skipped: this.current.skipped + 1 }); return
      }
      // 先记录未完成状态；强制退出后绝不会把半次解码当成通过。
      save('scanning', saved?.error_info ?? null)
      this.update({ phase: 'decoding' })
      const checksum = await readFlacChecksum(source)
      const result = await runAudioDecoder(this.binary, ['-nostdin', '-hide_banner', '-v', 'warning', '-threads', '1',
        '-i', source, '-map', '0:a:0', '-vn', '-sn', '-dn', '-threads', '1',
        ...(checksum ? ['-c:a', `pcm_${checksum.format}`, '-f', checksum.format] : ['-f', 'null']), '-'], this.abort.signal, checksum !== null)
      let decoderDiagnostics = result.diagnostics
      const coverTimescaleWarning = /^(?:\[[^\]]+\]\s*)?stream 0, timescale not set$/
      if (result.code === 0 && extname(source).toLowerCase() === '.m4a' &&
        decoderDiagnostics.split('\n').some(line => coverTimescaleWarning.test(line)) && await hasM4aCoverWithValidAudioTiming(source)) {
        decoderDiagnostics = decoderDiagnostics.split('\n').filter(line => !coverTimescaleWarning.test(line)).join('\n')
      }
      if (!isSameAudioFile(before, await lstat(source))) throw new Error('解码期间文件已改变，结果未采用，请重新扫描')
      const diagnostics: string[] = []
      if (checksum) {
        const samples = result.pcmBytes / (checksum.channels * checksum.bytesPerSample)
        if (result.pcmMd5 !== checksum.md5) diagnostics.push('FLAC 音频 MD5 与 STREAMINFO 不一致')
        if (samples !== checksum.samples) diagnostics.push(`FLAC 采样数量不一致（预期 ${checksum.samples}，实际 ${samples}）`)
      }
      // 声音数据完整且与内置校验一致时，忽略尾部附加数据等解码诊断。
      const verified = checksum !== null && diagnostics.length === 0 && result.code === 0
      if (!verified && decoderDiagnostics) diagnostics.push(decoderDiagnostics)
      if (result.code !== 0) diagnostics.push(`音频无法完整解码（退出码 ${result.code}）`)
      const message = diagnostics.join('\n') || null
      save(message ? 'problem' : 'ok', message)
      this.update({ completed: this.current.completed + 1, scanned: this.current.scanned + 1 }, issueChanges)
    } catch (error) {
      if (this.abort.signal.aborted) return
      const message = (error as NodeJS.ErrnoException).code === 'ENOENT' ? '音频文件不存在' : error instanceof Error ? error.message : String(error)
      save('failed', message)
      this.update({ completed: this.current.completed + 1, failed: this.current.failed + 1 }, issueChanges)
    }
  }
}
