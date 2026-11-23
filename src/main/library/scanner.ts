import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { IAudioMetadata } from 'music-metadata'
import { parseAudioMetadata as parseFile } from './audioMetadata'
import type { LibraryPaths } from './paths'
import type { AppendEntry } from '../../shared/types'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.ape'])
const MAX_APPEND_METADATA_ENTRIES = 512
const appendMetadataCache = new Map<string, { revision: string; entry: AppendEntry }>()

function cacheAppendMetadata(path: string, revision: string, entry: AppendEntry): void {
  appendMetadataCache.delete(path)
  appendMetadataCache.set(path, { revision, entry })
  while (appendMetadataCache.size > MAX_APPEND_METADATA_ENTRIES) {
    const oldest = appendMetadataCache.keys().next().value as string | undefined
    if (!oldest) break
    appendMetadataCache.delete(oldest)
  }
}

/* 与音频同名的 .lrc 文件（如 "X.flac" 对应 "X.lrc"），未找到则 lyric/lyricFilePath 均为 null */
function findMatchingLyricFile(
  paths: LibraryPaths,
  audioFileName: string
): { lyric: string | null; lyricFilePath: string | null } {
  const lyricFileName = `${audioFileName.slice(0, -extname(audioFileName).length)}.lrc`
  const lyricPath = join(paths.append, lyricFileName)
  if (!existsSync(lyricPath)) return { lyric: null, lyricFilePath: null }
  return { lyric: readFileSync(lyricPath, 'utf-8'), lyricFilePath: lyricPath }
}

/*
 * ID3v2.3 标准的年份帧 TYER 本该只存 4 位数字年份，完整日期要靠额外的 TDAT（DDMM）+ TIME 帧拼出来，
 * music-metadata 对此無视——只把 TYER 映射进 common.year，TDAT/TIME 完全不出现在 common 里，
 * 只留在 native 原始标签中，需要手动拼回 "YYYY-MM-DD"。
 * 但实际遇到的文件里（yt-dlp/ffmpeg 等工具写的标签）经常不遵守标准，直接把完整日期字符串
 * "2022-06-14" 整个塞进 TYER 帧本身，这种情况下 TYER 的值已经是完整日期，直接原样使用即可，
 * 不需要再去找 TDAT。两种情况都处理，ID3v2.2 对应的两字母帧 TYE/TDA 同理。
 */
function combineId3v2SplitDate(native: IAudioMetadata['native']): string | null {
  const allTags = Object.values(native).flat()
  const yearTag = allTags.find((t) => t.id === 'TYER' || t.id === 'TYE')?.value
  const yearRaw = typeof yearTag === 'string' || typeof yearTag === 'number' ? String(yearTag) : ''

  // 非标准写法：TYER 本身就是完整日期（如 "2022-06-14"），直接采用
  if (/^\d{4}-\d{2}-\d{2}$/.test(yearRaw)) return yearRaw

  if (!/^\d{4}$/.test(yearRaw)) return null

  // 标准写法：TYER 只有年份，完整日期靠额外的 TDAT（DDMM）帧拼出来
  const dateTag = allTags.find((t) => t.id === 'TDAT' || t.id === 'TDA')?.value
  if (typeof dateTag === 'string' && /^\d{4}$/.test(dateTag)) {
    const day = dateTag.slice(0, 2)
    const month = dateTag.slice(2, 4)
    return `${yearRaw}-${month}-${day}`
  }
  return yearRaw
}

/*
 * 发行日期取值优先级：releasedate（最明确的"发行日期"字段）> originaldate（原始发行日期，
 * 常见于重发/合集场景标注原始年代）> date（笼统的"日期"标签，各软件写入含义不一）>
 * ID3v2.3/2.2 拆分日期拼接兜底 > year/originalyear（只有年份精度时最后兜底）。
 */
function extractReleaseDate(meta: IAudioMetadata): string | null {
  const common = meta.common
  return (
    common.releasedate ??
    common.originaldate ??
    common.date ??
    combineId3v2SplitDate(meta.native) ??
    (common.year ? String(common.year) : null) ??
    (common.originalyear ? String(common.originalyear) : null)
  )
}

/*
 * 扫描 Append/ 根目录下的音频文件，解析出 mp3tag 展示信息。
 * 按加入 Append 的时间升序排列（越新越靠后）：移动/复制进目录会刷新 ctime，与 Finder 的"添加日期"一致；
 * mtime 与创建时间都会随文件保留原值，不能代表加入时间。同一时刻加入的按文件名排序。
 */
export async function scanAppendFolder(paths: LibraryPaths): Promise<AppendEntry[]> {
  const entries = readdirSync(paths.append)
    .map((name) => ({ name, stat: statSync(join(paths.append, name)) }))
    .filter(({ name, stat }) => stat.isFile() && AUDIO_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort((a, b) => a.stat.ctimeMs - b.stat.ctimeMs || a.name.localeCompare(b.name))

  const currentPaths = new Set(entries.map(({ name }) => join(paths.append, name)))
  for (const path of appendMetadataCache.keys()) {
    if (!currentPaths.has(path)) appendMetadataCache.delete(path)
  }

  const results: AppendEntry[] = []
  for (const { name: fileName, stat } of entries) {
    const full = join(paths.append, fileName)
    const fileRevision = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    /* 歌词文件与解析音频元数据无关，两者失败互不影响，放在 try 外单独取 */
    const { lyric, lyricFilePath } = findMatchingLyricFile(paths, fileName)
    const cached = appendMetadataCache.get(full)
    if (cached?.revision === fileRevision) {
      appendMetadataCache.delete(full)
      appendMetadataCache.set(full, cached)
      results.push({ ...cached.entry, lyric, lyricFilePath })
      continue
    }
    try {
      /* OGG 的时长依赖末页采样位置，必须显式要求解析到文件末尾。 */
      const meta = await parseFile(full, { duration: true })
      results.push({
        fileName,
        fileRevision,
        title: meta.common.title ?? fileName.replace(extname(fileName), ''),
        /* 有些标签把多位艺术家存成 TPE1 的多个值（music-metadata 会解析进 common.artists 数组），
           而 common.artist 只取第一个值，这里优先用 artists 数组拼接，避免漏掉后面的艺术家 */
        artist: meta.common.artists?.length ? meta.common.artists.join(' / ') : meta.common.artist ?? null,
        album: meta.common.album ?? null,
        /* 专辑艺术家来自 albumartist 字段本身，与上面的主艺术家字段来源不同，不做互相推断 */
        albumArtist: meta.common.albumartist ?? null,
        /* music-metadata 原生返回厂牌数组，完整保留并去除空白项。 */
        labels: [...new Set((meta.common.label ?? []).map((label) => label.trim()).filter(Boolean))],
        lyric,
        lyricFilePath,
        releaseDate: extractReleaseDate(meta),
        discNumber: meta.common.disk?.no ?? null,
        totalDiscs: meta.common.disk?.of ?? null,
        trackNumber: meta.common.track?.no ?? null,
        duration: meta.format.duration ? Math.round(meta.format.duration) : null,
        hasPicture: (meta.common.picture?.length ?? 0) > 0
      })
      cacheAppendMetadata(full, fileRevision, results[results.length - 1])
    } catch {
      // 解析失败（文件损坏/格式不支持）：仍展示条目，字段留空，供用户手动处理
      results.push({
        fileName,
        fileRevision,
        title: fileName.replace(extname(fileName), ''),
        artist: null,
        album: null,
        albumArtist: null,
        labels: [],
        lyric,
        lyricFilePath,
        releaseDate: null,
        discNumber: null,
        totalDiscs: null,
        trackNumber: null,
        duration: null,
        hasPicture: false
      })
      cacheAppendMetadata(full, fileRevision, results[results.length - 1])
    }
  }
  return results
}

/* 获取某个 Append 文件内嵌的封面图片二进制数据（用于前端展示预览） */
export async function getAppendCover(paths: LibraryPaths, fileName: string): Promise<Buffer | null> {
  if (!fileName || basename(fileName) !== fileName || /[/\\]/.test(fileName)) return null
  const full = join(paths.append, fileName)
  const meta = await parseFile(full)
  const pic = meta.common.picture?.[0]
  return pic ? Buffer.from(pic.data) : null
}
