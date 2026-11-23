import { open } from 'node:fs/promises'

interface Box { type: string; start: number; end: number }

// covr 是静态图片，不含 mdhd。FFmpeg 为其创建临时流时可能打印 stream 0 时间基警告。
// 只有确认真实音频轨 mdhd 有效且确有内嵌封面，才允许忽略这一条提示。
export async function hasM4aCoverWithValidAudioTiming(source: string): Promise<boolean> {
  const file = await open(source, 'r')
  try {
    let budget = 4096
    async function read(position: number, length: number): Promise<Buffer> {
      const bytes = Buffer.alloc(length)
      for (let offset = 0; offset < length;) {
        const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset)
        if (!bytesRead) throw new Error('MP4 数据不完整')
        offset += bytesRead
      }
      return bytes
    }
    async function boxes(start: number, end: number): Promise<Box[]> {
      const result: Box[] = []
      for (let position = start; position < end;) {
        if (--budget < 0 || end - position < 8) throw new Error('MP4 结构无效')
        const header = await read(position, 8)
        let length = header.readUInt32BE(0), headerSize = 8
        if (length === 1) {
          if (end - position < 16) throw new Error('MP4 结构无效')
          const extended = (await read(position + 8, 8)).readBigUInt64BE(0)
          if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 结构无效')
          length = Number(extended); headerSize = 16
        }
        if (length === 0) length = end - position
        if (length < headerSize || length > end - position) throw new Error('MP4 结构无效')
        result.push({ type: header.toString('latin1', 4, 8), start: position + headerSize, end: position + length })
        position += length
      }
      return result
    }
    const moov = (await boxes(0, (await file.stat()).size)).find(box => box.type === 'moov')
    if (!moov) return false
    const children = await boxes(moov.start, moov.end)
    let audioTracks = 0
    for (const track of children.filter(box => box.type === 'trak')) {
      const media = (await boxes(track.start, track.end)).find(box => box.type === 'mdia')
      if (!media) return false
      const mediaChildren = await boxes(media.start, media.end)
      const handler = mediaChildren.find(box => box.type === 'hdlr')
      if (!handler || handler.end - handler.start < 12) return false
      if ((await read(handler.start + 8, 4)).toString('ascii') !== 'soun') continue
      const mdhd = mediaChildren.find(box => box.type === 'mdhd')
      if (!mdhd || mdhd.end - mdhd.start < 4) return false
      const version = (await read(mdhd.start, 1))[0]
      if (version !== 0 && version !== 1) return false
      const scaleOffset = version === 1 ? 20 : 12
      if (mdhd.end - mdhd.start < scaleOffset + 4 || (await read(mdhd.start + scaleOffset, 4)).readUInt32BE(0) === 0) return false
      audioTracks++
    }
    if (!audioTracks) return false
    const metadata = children.filter(box => box.type === 'meta')
    for (const udta of children.filter(box => box.type === 'udta')) metadata.push(...(await boxes(udta.start, udta.end)).filter(box => box.type === 'meta'))
    for (const meta of metadata) {
      if (meta.end - meta.start < 4) continue
      const list = (await boxes(meta.start + 4, meta.end)).find(box => box.type === 'ilst')
      if (list && (await boxes(list.start, list.end)).some(box => box.type === 'covr' && box.end - box.start > 16)) return true
    }
    return false
  } catch {
    // 无法确认时保留原始诊断，避免隐藏真实的音频时间基缺失。
    return false
  } finally { await file.close() }
}
