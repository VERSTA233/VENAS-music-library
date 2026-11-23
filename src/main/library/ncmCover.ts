import { createDecipheriv } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/* NCM 元数据块的公开 AES-128-ECB 密钥；解密结果为 "music:" + JSON。 */
const META_KEY = Buffer.from('2331346C6A6B5F215C5D2630553C2728', 'hex')
const META_PREFIX = "163 key(Don't modify):"

interface NcmLayout {
  musicId: string | null
  /* 封面帧长字段的偏移；其后依次为图片长度、图片数据，帧结束处即音频开始。 */
  coverFrameOffset: number
  imageLength: number
  audioOffset: number
}

function parseMusicId(meta: Buffer): string | null {
  try {
    const text = Buffer.from(meta.map((byte) => byte ^ 0x63)).toString('utf8')
    if (!text.startsWith(META_PREFIX)) return null
    const decipher = createDecipheriv('aes-128-ecb', META_KEY, null)
    const plain = Buffer.concat([decipher.update(Buffer.from(text.slice(META_PREFIX.length), 'base64')), decipher.final()]).toString('utf8')
    if (!plain.startsWith('music:')) return null
    const musicId = (JSON.parse(plain.slice('music:'.length)) as { musicId?: unknown }).musicId
    return musicId == null ? null : String(musicId)
  } catch {
    return null
  }
}

/* 结构：魔数(8) 间隔(2) 密钥块 元数据块 CRC(4) 间隔(1) 封面帧长(4) 图片长(4) 图片 帧剩余 音频。 */
function readLayout(data: Buffer): NcmLayout | null {
  if (data.length < 10 || data.toString('latin1', 0, 8) !== 'CTENFDAM') return null
  let offset = 10
  const keyLength = data.readUInt32LE(offset)
  offset += 4 + keyLength
  const metaLength = data.readUInt32LE(offset)
  const meta = data.subarray(offset + 4, offset + 4 + metaLength)
  offset += 4 + metaLength + 5
  if (offset + 8 > data.length) return null
  const frameLength = data.readUInt32LE(offset)
  const imageLength = data.readUInt32LE(offset + 4)
  const audioOffset = offset + 8 + Math.max(frameLength, imageLength)
  if (audioOffset > data.length) return null
  return { musicId: metaLength > 0 ? parseMusicId(meta) : null, coverFrameOffset: offset, imageLength, audioOffset }
}

/* 网易云把封面单独缓存为 meta/track-<musicId>.jpg，重复下载会出现 " (1)" 后缀；取最新的一份。 */
function findLocalCover(metaDirectory: string, musicId: string): string | null {
  const pattern = new RegExp(`^track-${musicId}( \\(\\d+\\))?\\.(jpe?g|png)$`, 'i')
  let latest: { path: string; mtime: number } | null = null
  try {
    for (const entry of readdirSync(metaDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue
      const path = join(metaDirectory, entry.name)
      const mtime = statSync(path).mtimeMs
      if (!latest || mtime > latest.mtime) latest = { path, mtime }
    }
  } catch {
    return null
  }
  return latest?.path ?? null
}

/*
 * NCM 未内嵌封面时，把网易云 meta 目录中的对应封面写入副本的封面帧，交给 ncmdump 按原逻辑嵌入音频。
 * 返回副本路径；已有封面、找不到封面或结构无法识别时返回 null，调用方继续解码原文件。
 */
export function prepareNcmWithLocalCover(sourcePath: string, metaDirectory: string, outputPath: string): string | null {
  const data = readFileSync(sourcePath)
  const layout = readLayout(data)
  if (!layout || layout.imageLength > 0 || !layout.musicId) return null
  const coverPath = findLocalCover(metaDirectory, layout.musicId)
  if (!coverPath) return null
  const image = readFileSync(coverPath)
  if (image.length === 0) return null

  const lengths = Buffer.alloc(8)
  lengths.writeUInt32LE(image.length, 0)
  lengths.writeUInt32LE(image.length, 4)
  writeFileSync(outputPath, Buffer.concat([
    data.subarray(0, layout.coverFrameOffset),
    lengths,
    image,
    data.subarray(layout.audioOffset)
  ]))
  return outputPath
}
