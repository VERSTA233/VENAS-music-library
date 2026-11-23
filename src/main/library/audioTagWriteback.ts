import type Database from 'better-sqlite3'
import { Worker } from 'node:worker_threads'
import { randomUUID, createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { AudioTagWriteProgress } from '../../shared/types'
import type { LibraryPaths } from './paths'
import { getSongDetail } from '../db/queries/songs'
import { buildFlacTagValues } from './audioTagValues'
import type { AudioTagWork } from './audioTagWorker'
import { hashAudioFile, isSameAudioFile } from './audioFileHash'
import { audioFileOperations } from './audioFileOperations'

// 修改映射、清空规则或写入实现时必须递增；旧成功记录会自然失效。
export const AUDIO_TAG_WRITER_VERSION = '1-tdrc-grp1'
const formats = new Set(['.flac', '.mp3', '.wav', '.ogg', '.m4a'])

function audioMetadataHash(values: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}

interface SavedState {
  status: string; metadata_hash: string | null; file_hash: string | null; writer_version: string | null
}

export function canSkipAudioTags(saved: SavedState | undefined, metadataHash: string, fileHash: string): boolean {
  return saved?.status === 'succeeded' && saved.metadata_hash === metadataHash && saved.file_hash === fileHash && saved.writer_version === AUDIO_TAG_WRITER_VERSION
}

export class AudioTagWriter {
  private revision = 0
  private current: AudioTagWriteProgress | null = null
  private cancellationRequested = false
  completion: Promise<void> = Promise.resolve()

  constructor(
    private readonly paths: LibraryPaths,
    private readonly database: () => Database.Database,
    private readonly workerFile: string,
    private readonly binary: string,
    private readonly publish: (progress: AudioTagWriteProgress) => void,
    private readonly runLibraryOperation: (operation: () => Promise<void>) => Promise<void> = operation => operation()
  ) {}

  get progress(): AudioTagWriteProgress | null { return this.current ? structuredClone(this.current) : null }
  get running(): boolean { return this.current?.status === 'running' || this.current?.status === 'cancelling' }

  private update(patch: Partial<AudioTagWriteProgress>): void {
    this.current = { ...this.current!, ...patch, revision: ++this.revision }
    this.publish(this.progress!)
  }

  start(songIds?: number[]): AudioTagWriteProgress {
    if (this.running) return this.progress!
    const ids = songIds ? [...new Set(songIds)] : this.database().prepare<[], { id: number }>('SELECT id FROM songs ORDER BY id').all().map(row => row.id)
    this.cancellationRequested = false
    this.update({ taskId: randomUUID(), status: 'running', phase: 'checking', total: ids.length, completed: 0, written: 0, skipped: 0, failed: 0, currentSong: null, errors: [] })
    this.completion = this.runLibraryOperation(() => this.execute(ids)).catch(error => {
      this.update({ status: 'failed', currentSong: null, errors: [...this.current!.errors, { songId: null, title: '写入任务', fileName: '', message: error instanceof Error ? error.message : String(error) }] })
    })
    return this.progress!
  }

  cancel(): AudioTagWriteProgress | null {
    if (this.running) {
      this.cancellationRequested = true
      this.update({ status: 'cancelling' })
    }
    return this.progress
  }

  private async execute(ids: number[]): Promise<void> {
    for (const songId of ids) {
      if (this.cancellationRequested) break
      await audioFileOperations.run(() => this.writeSong(songId))
    }
    this.update({ status: this.cancellationRequested ? 'cancelled' : 'completed', currentSong: null })
  }

  private async writeSong(songId: number): Promise<void> {
    if (this.cancellationRequested) return
    const db = this.database()
    // 单首的详情在同一 SQLite 快照内读取。完成时记录的仍是这一份数据，编辑不会被误记成功。
    const song = db.transaction(() => getSongDetail(db, songId))()
    if (!song) { this.update({ completed: this.current!.completed + 1, skipped: this.current!.skipped + 1 }); return }
    const currentSong = { songId, title: song.title, fileName: song.file_name }
    this.update({ currentSong, phase: 'checking' })
    const values = buildFlacTagValues(song), metadataHash = audioMetadataHash(values)
    let fileHash: string | null = null
    const save = (status: string, hash: string | null, error: string | null): void => {
      db.prepare(`INSERT INTO audio_tag_write_state (song_id, status, metadata_hash, file_hash, writer_version, error_info)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET status=excluded.status,
        metadata_hash=excluded.metadata_hash, file_hash=excluded.file_hash, writer_version=excluded.writer_version, error_info=excluded.error_info`)
        .run(songId, status, metadataHash, hash, AUDIO_TAG_WRITER_VERSION, error)
    }
    let result: 'written' | 'skipped' = 'written'
    try {
      if (basename(song.file_name) !== song.file_name || /[/\\]/.test(song.file_name)) throw new Error('音频文件名不合法')
      if (!formats.has(extname(song.file_name).toLowerCase())) throw new Error('不支持的标签格式；目前支持 FLAC、MP3、WAV、Ogg Vorbis、M4A')
      const source = join(this.paths.music, song.file_name)
      const before = await lstat(source)
      // 文件名已限制为单个 basename，不能对 realpath 的 Unicode 形式做字符串等值判断：
      // macOS 上同一个日文文件名可能以 NFC / NFD 两种等价形式返回。
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('拒绝修改链接或非普通音频文件')
      fileHash = await hashAudioFile(source)
      const after = await lstat(source)
      if (!isSameAudioFile(before, after)) throw new Error('检查期间音频文件发生变化，请重试')
      const saved = db.prepare<[number], SavedState>('SELECT status, metadata_hash, file_hash, writer_version FROM audio_tag_write_state WHERE song_id = ?').get(songId)
      if (canSkipAudioTags(saved, metadataHash, fileHash)) result = 'skipped'
      else {
        save('writing', fileHash, null)
        const outputHash = await this.runWorker({ songId, source, sourceHash: fileHash, values, binary: this.binary })
        // 如在此处退出或 SQLite 提交失败，状态仍为 writing/failed，下次必然重试。
        save('succeeded', outputHash, null)
      }
    } catch (error) {
      const message = (error as NodeJS.ErrnoException).code === 'ENOENT' ? '音频文件或标签写入工具不存在' : error instanceof Error ? error.message : String(error)
      save('failed', fileHash, message)
      this.update({ completed: this.current!.completed + 1, failed: this.current!.failed + 1, errors: [...this.current!.errors, { ...currentSong, message }] })
      return
    }
    this.update({ completed: this.current!.completed + 1, [result]: this.current![result] + 1 })
  }

  private runWorker(work: AudioTagWork): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerFile, { workerData: work })
      let fileHash: string | undefined, failure: Error | undefined
      worker.on('message', message => {
        if (message.phase) this.update({ phase: message.phase })
        if (message.fileHash) fileHash = message.fileHash
        if (message.error) failure = new Error(message.error)
      })
      worker.once('error', reject)
      worker.once('exit', code => {
        if (code === 0 && fileHash && !failure) resolve(fileHash)
        else reject(failure ?? new Error(`标签工作线程异常退出 (${code})`))
      })
    })
  }
}
