import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { parseFile } from 'music-metadata'
import { encodedMediaHash, inspectId3Tags, inspectMp4Tags, oggPackets } from './audioTagInspection.mjs'

const id3 = { TITLE: 'TIT2', ARTIST: 'TPE1', ALBUM: 'TALB', DATE: 'TDRC', TRACKNUMBER: 'TRCK', GENRE: 'TCON', MOOD: 'TMOO', ALBUMARTIST: 'TPE2', GROUPING: 'GRP1', LABEL: 'TXXX:LABEL', WORK: 'TXXX:WORK', RELEASETYPE: 'TXXX:RELEASETYPE', LYRICS: 'USLT', COMMENT: 'COMM' }
const mp4 = { TITLE: '©nam', ARTIST: '©ART', ALBUM: '©alb', DATE: '©day', GENRE: '©gen', ALBUMARTIST: 'aART', WORK: '©wrk', GROUPING: '©grp', LYRICS: '©lyr', COMMENT: '©cmt', LABEL: '----:com.apple.iTunes:LABEL', MOOD: '----:com.apple.iTunes:MOOD', RELEASETYPE: '----:com.apple.iTunes:RELEASETYPE' }

export type NativeTagFormat = 'mp3' | 'wav' | 'ogg' | 'm4a'

function vorbisValues(bytes: Buffer): Record<string, string[]> {
  const packet: Buffer = oggPackets(bytes)[1]
  let position = 7
  const number = (): number => {
    if (position + 4 > packet.length) throw new Error('Vorbis 注释长度无效')
    const n = packet.readUInt32LE(position); position += 4; return n
  }
  const vendorSize = number(); position += vendorSize
  const count = number(), values: Record<string, string[]> = {}
  if (count > packet.length / 4) throw new Error('Vorbis 注释数量无效')
  for (let i = 0; i < count; i++) {
    const length = number()
    if (position + length > packet.length) throw new Error('Vorbis 注释不完整')
    const text = packet.toString('utf8', position, position + length); position += length
    const separator = text.indexOf('=')
    if (separator < 1) throw new Error('Vorbis 注释字段无效')
    ;(values[text.slice(0, separator).toUpperCase()] ??= []).push(text.slice(separator + 1))
  }
  return values
}

export async function inspectNativeAudio(file: string, format: NativeTagFormat, clearAlbum: boolean, readValues = true): Promise<{
  audioHash: string; picturesHash: string; values: Record<string, (string | number[])[]>
}> {
  // 每次只处理一首并结束工作线程。过大的非 FLAC 文件报告失败，避免无限制占用内存。
  if ((await stat(file)).size > 512 * 1024 * 1024) throw new Error('该非 FLAC 文件超过 512 MiB，暂不支持安全校验，未修改原文件')
  const bytes = await readFile(file)
  const parsed = await parseFile(file, { duration: true })
  const pictures = (parsed.common.picture ?? []).map(picture => ({
    format: picture.format, type: picture.type, description: picture.description,
    hash: createHash('sha256').update(picture.data).digest('hex')
  }))
  return {
    audioHash: encodedMediaHash(bytes, format, clearAlbum),
    picturesHash: createHash('sha256').update(JSON.stringify(pictures)).digest('hex'),
    values: !readValues ? {} : format === 'm4a' ? inspectMp4Tags(bytes) : format === 'ogg' ? vorbisValues(bytes) : inspectId3Tags(bytes, format)
  }
}

export function verifyNativeValues(format: NativeTagFormat, actual: Record<string, (string | number[])[]>, expected: Record<string, string>): void {
  for (const [name, value] of Object.entries(expected)) {
    let key: string, wanted: string | number = value, part: number | undefined
    if (name === 'DISCNUMBER' || name === 'DISCTOTAL' || (format === 'm4a' && name === 'TRACKNUMBER')) {
      key = format === 'm4a' ? (name === 'TRACKNUMBER' ? 'trkn' : 'disk') : format === 'ogg' ? name : 'TPOS'
      if (format === 'm4a') { part = name === 'DISCTOTAL' ? 1 : 0; wanted = Number(value) }
      else if (format !== 'ogg') part = name === 'DISCTOTAL' ? 1 : 0
    } else key = format === 'm4a' ? mp4[name] : format === 'ogg' ? name : id3[name]
    if (!key) throw new Error(`没有校验映射：${name}`)
    const values = actual[key] ?? []
    if (value === '') {
      if (values.length) throw new Error(`${name} 未正确清空`)
    } else {
      const got = part == null ? values[0] : format === 'm4a' ? values[0]?.[part] : String(values[0] ?? '').split('/')[part]
      if (values.length !== 1 || got !== wanted) throw new Error(`${name} 写入值校验失败`)
    }
  }
}
