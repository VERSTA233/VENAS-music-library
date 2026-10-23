import { basename, join } from 'node:path'
import { parseFile } from 'music-metadata'
import type Database from 'better-sqlite3'
import type { LibraryPaths } from './paths'

/* 补全旧版提前结束 OGG 解析而留下的空时长；成功的记录下次启动不再扫描。 */
export async function repairMissingOggDurations(paths: LibraryPaths, db: Database.Database): Promise<void> {
  const songs = db
    .prepare<[], { id: number; file_name: string }>(
      "SELECT id, file_name FROM songs WHERE (length IS NULL OR length <= 0) AND lower(file_name) LIKE '%.ogg'"
    )
    .all()
  const update = db.prepare(
    'UPDATE songs SET length = ? WHERE id = ? AND file_name = ? AND (length IS NULL OR length <= 0)'
  )

  for (const song of songs) {
    if (basename(song.file_name) !== song.file_name || /[/\\]/.test(song.file_name)) continue
    try {
      const metadata = await parseFile(join(paths.music, song.file_name), { duration: true, skipCovers: true })
      const duration = metadata.format.duration
      if (duration != null && Number.isFinite(duration) && Math.round(duration) > 0) {
        update.run(Math.round(duration), song.id, song.file_name)
      }
    } catch {
      /* 缺失或损坏的音频保留原值，不阻止启动；文件恢复后下次启动重试。 */
    }
  }
}
