import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type Database from 'better-sqlite3'
import type { MissingAudioFile, PlaylistExportInspection, PlaylistExportOutcome, PlaylistExportResult } from '../../shared/types'
import type { LibraryPaths } from './paths'

interface ExportSong {
  id: number
  title: string
  file_name: string
}

interface ExportTag {
  id: number
  name: string
  tag_type: string | null
}

interface ExportSnapshot {
  token: string
  tags: ExportTag[]
  songs: ExportSong[]
  links: { tag_id: number; song_id: number }[]
  missingFiles: MissingAudioFile[]
}

/* 不替换用户名称；拒绝路径穿越及会改变 M3U 行结构的名称，避免输出到 Playlist 以外。 */
function assertSegment(name: string): void {
  if (!name || name === '.' || name === '..' || basename(name) !== name || /[/\\\r\n\0]/.test(name)) {
    throw new Error(`无法导出名称：${name}`)
  }
}

function isAbsent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/* 按歌曲检查，避免一首歌因多个 Tag 重复检查；包含无 Tag 的歌曲，不读取音频内容。 */
async function missingAudio(music: string, songs: ExportSong[]): Promise<MissingAudioFile[]> {
  const missing: MissingAudioFile[] = []
  for (let offset = 0; offset < songs.length; offset += 64) {
    const batch = await Promise.all(songs.slice(offset, offset + 64).map(async (song) => {
      assertSegment(song.file_name)
      try {
        if ((await stat(join(music, song.file_name))).isFile()) return null
      } catch (error) {
        if (!isAbsent(error)) throw error
      }
      return { songId: song.id, title: song.title, fileName: song.file_name }
    }))
    missing.push(...batch.filter((song): song is MissingAudioFile => song !== null))
  }
  return missing
}

/* 仅完整生成且校验过的临时目录可以发布。旧目录在提交前保留，提交失败则恢复。 */
async function publishDirectory(stage: string, destination: string): Promise<string[]> {
  const backup = join(destination, '..', `.Playlist.backup-${randomUUID()}`)
  let hasPrevious = false
  try {
    const info = await lstat(destination)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Music/Playlist 必须是普通文件夹')
    hasPrevious = true
  } catch (error) {
    if (!isAbsent(error)) throw error
  }
  if (hasPrevious) await rename(destination, backup)
  try {
    await rename(stage, destination)
  } catch (error) {
    if (hasPrevious) {
      try {
        await rename(backup, destination)
      } catch {
        throw new Error(`替换 Playlist 失败，旧结果保留在 ${backup}，请恢复该目录。`)
      }
    }
    throw error
  }
  if (hasPrevious) {
    try {
      await rm(backup, { recursive: true })
    } catch {
      return [`新结果已生成，旧备份未能删除：${backup}`]
    }
  }
  return []
}

export class PlaylistExporter {
  private pending: ExportSnapshot | null = null
  private busy = false
  private readonly paths: LibraryPaths

  constructor(paths: LibraryPaths) {
    this.paths = paths
  }

  async inspect(db: Database.Database): Promise<PlaylistExportInspection> {
    if (this.busy) throw new Error('Playlist 正在生成，请等待完成')
    this.busy = true
    this.pending = null
    try {
      /* 三次查询在同一个同步只读事务中完成；文件检查和写入不占用数据库事务。 */
      const snapshot: ExportSnapshot = db.transaction(() => ({
        token: randomUUID(),
        tags: db.prepare<[], ExportTag>('SELECT id, name, tag_type FROM tags ORDER BY id').all(),
        songs: db.prepare<[], ExportSong>('SELECT id, title, file_name FROM songs ORDER BY title COLLATE NOCASE, id').all(),
        links: db.prepare<[], { tag_id: number; song_id: number }>(
          'SELECT tag_id, song_id FROM song_tags ORDER BY tag_id, sort_order ASC, song_id ASC'
        ).all(),
        missingFiles: []
      }))()
      snapshot.missingFiles = await missingAudio(this.paths.music, snapshot.songs)
      this.pending = snapshot
      return { token: snapshot.token, missingFiles: snapshot.missingFiles }
    } finally {
      this.busy = false
    }
  }

  cancel(token: string): void {
    if (!this.busy && this.pending?.token === token) this.pending = null
  }

  async generate(token: string, skipMissing = false): Promise<PlaylistExportOutcome> {
    if (this.busy) throw new Error('Playlist 正在生成，请等待完成')
    const snapshot = this.pending
    if (!snapshot || token !== snapshot.token) throw new Error('生成记录已失效，请重新点击生成')
    this.busy = true
    let stage: string | null = null
    try {
      const acknowledgedIds = new Set(skipMissing ? snapshot.missingFiles.map((song) => song.songId) : [])
      const needsConfirmation = (missing: MissingAudioFile[]): PlaylistExportOutcome | null => {
        snapshot.missingFiles = missing
        return missing.some((song) => !acknowledgedIds.has(song.songId))
          ? { status: 'confirmation-required', inspection: { token, missingFiles: missing } }
          : null
      }
      const missing = await missingAudio(this.paths.music, snapshot.songs)
      const confirmation = needsConfirmation(missing)
      if (confirmation) return confirmation

      const absentIds = new Set(missing.map((song) => song.songId))
      const songsById = new Map(snapshot.songs.map((song) => [song.id, song]))
      const linksByTag = new Map<number, number[]>()
      for (const link of snapshot.links) {
        const links = linksByTag.get(link.tag_id) ?? []
        links.push(link.song_id)
        linksByTag.set(link.tag_id, links)
      }

      stage = await mkdtemp(join(this.paths.music, '.Playlist.generating-'))
      const types = new Set<string>()
      const includedSongs = new Set<number>()
      const expectedFiles = new Map<string, string>()
      let entryCount = 0
      for (const tag of snapshot.tags) {
        const type = tag.tag_type ?? '未分类'
        assertSegment(type)
        assertSegment(tag.name)
        if (!types.has(type)) {
          await mkdir(join(stage, type))
          types.add(type)
        }
        const destination = join(stage, type, `${tag.name}.m3u`)
        const lines: string[] = []
        for (const id of linksByTag.get(tag.id) ?? []) {
          const song = songsById.get(id)
          if (!song || absentIds.has(id)) continue
          lines.push(relative(join(stage, type), join(this.paths.music, song.file_name)).split(sep).join('/'))
          includedSongs.add(id)
          entryCount++
        }
        const contents = lines.length > 0 ? `${lines.join('\n')}\n` : ''
        /* wx 拒绝文件系统大小写/Unicode 等价重名，避免覆盖另一 Tag 的结果。 */
        await writeFile(destination, contents, { encoding: 'utf8', flag: 'wx' })
        expectedFiles.set(destination, contents)
      }
      for (const [file, contents] of expectedFiles) {
        if (await readFile(file, 'utf8') !== contents) throw new Error(`歌单写入校验失败：${file}`)
      }
      /* 用户确认后或写入期间又有音频丢失时，重新提示，绝不无声地扩大跳过范围。 */
      const finalMissing = await missingAudio(this.paths.music, snapshot.songs)
      if (finalMissing.some((song) => !absentIds.has(song.songId))) {
        snapshot.missingFiles = finalMissing
        return { status: 'confirmation-required', inspection: { token, missingFiles: finalMissing } }
      }

      const directory = join(this.paths.music, 'Playlist')
      const warnings = await publishDirectory(stage, directory)
      stage = null
      this.pending = null
      const result: PlaylistExportResult = {
        directory, typeCount: types.size, playlistCount: snapshot.tags.length,
        songCount: includedSongs.size, entryCount, skippedFiles: missing, warnings
      }
      return { status: 'complete', result }
    } finally {
      if (stage) await rm(stage, { recursive: true, force: true }).catch(() => undefined)
      this.busy = false
    }
  }
}
