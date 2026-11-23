import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs'

/* 网易云客户端写入的加密来源信息：FLAC 存于 DESCRIPTION，MP3 存于 COMM 帧。 */
const NETEASE_KEY_PREFIX = '163 key'

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  const bytesRead = readSync(fd, buffer, 0, length, position)
  if (bytesRead !== length) throw new Error('音频文件头不完整')
  return buffer
}

/*
 * 删除 Vorbis 注释中值以 "163 key" 开头的字段。删去的字节并入紧随其后的 PADDING 块，
 * 没有 PADDING 时新建一个，保证元数据区总长度不变，只原地改写文件头。
 */
function stripFlac(fd: number): boolean {
  let position = 4
  for (;;) {
    const header = readAt(fd, position, 4)
    const isLast = (header[0] & 0x80) !== 0
    const type = header[0] & 0x7f
    const length = header.readUIntBE(1, 3)
    if (type !== 4) {
      if (isLast) return false
      position += 4 + length
      continue
    }

    const block = readAt(fd, position + 4, length)
    const vendorLength = block.readUInt32LE(0)
    let offset = 4 + vendorLength
    const count = block.readUInt32LE(offset)
    offset += 4
    const kept: Buffer[] = []
    for (let index = 0; index < count; index++) {
      const entryLength = block.readUInt32LE(offset)
      const entry = block.subarray(offset, offset + 4 + entryLength)
      const value = entry.toString('utf8', 4).split('=').slice(1).join('=')
      if (!value.startsWith(NETEASE_KEY_PREFIX)) kept.push(entry)
      offset += 4 + entryLength
    }
    if (kept.length === count) return false

    const countBytes = Buffer.alloc(4)
    countBytes.writeUInt32LE(kept.length)
    const comment = Buffer.concat([block.subarray(0, 4 + vendorLength), countBytes, ...kept])

    /* 可回收区域 = 本块 + 紧随其后的 PADDING 块（若有）。 */
    let reclaimable = 4 + length
    let regionIsLast = isLast
    if (!isLast) {
      const next = readAt(fd, position + 4 + length, 4)
      if ((next[0] & 0x7f) === 1) {
        reclaimable += 4 + next.readUIntBE(1, 3)
        regionIsLast = (next[0] & 0x80) !== 0
      }
    }
    const paddingLength = reclaimable - (4 + comment.length) - 4
    if (paddingLength < 0) throw new Error('FLAC 元数据空间不足，无法移除 163 key')

    const commentHeader = Buffer.from([0x04, 0, 0, 0])
    commentHeader.writeUIntBE(comment.length, 1, 3)
    const paddingHeader = Buffer.from([0x01 | (regionIsLast ? 0x80 : 0), 0, 0, 0])
    paddingHeader.writeUIntBE(paddingLength, 1, 3)
    const region = Buffer.concat([commentHeader, comment, paddingHeader, Buffer.alloc(paddingLength)])
    writeSync(fd, region, 0, region.length, position)
    return true
  }
}

function frameText(frame: Buffer): string {
  const encoding = frame[0]
  const body = frame.subarray(1)
  if (encoding === 1) return body.toString('utf16le')
  if (encoding === 2) return Buffer.from(body).swap16().toString('utf16le')
  if (encoding === 3) return body.toString('utf8')
  return body.toString('latin1')
}

function syncsafe(bytes: Buffer, offset: number): number {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f)
}

/* 删除 ID3v2.3/2.4 中含 "163 key" 的 COMM/TXXX 帧，空出的字节作为标签末尾填充，标签总长度不变。 */
function stripId3(fd: number): boolean {
  const header = readAt(fd, 0, 10)
  if (header.toString('latin1', 0, 3) !== 'ID3') return false
  const major = header[3]
  const flags = header[5]
  /* 全标签非同步化与 v2.2 的帧结构不同，不在此处理。 */
  if ((major !== 3 && major !== 4) || (flags & 0x80) !== 0) return false

  const tagSize = syncsafe(header, 6)
  const tag = readAt(fd, 10, tagSize)
  let offset = 0
  if ((flags & 0x40) !== 0) offset = major === 4 ? syncsafe(tag, 0) : 4 + tag.readUInt32BE(0)

  const frames: Buffer[] = [tag.subarray(0, offset)]
  let removed = false
  while (offset + 10 <= tagSize && tag[offset] !== 0) {
    const id = tag.toString('latin1', offset, offset + 4)
    const size = major === 4 ? syncsafe(tag, offset + 4) : tag.readUInt32BE(offset + 4)
    const end = offset + 10 + size
    if (end > tagSize) break
    const isNeteaseKey = (id === 'COMM' || id === 'TXXX') && frameText(tag.subarray(offset + 10, end)).includes(NETEASE_KEY_PREFIX)
    if (isNeteaseKey) removed = true
    else frames.push(tag.subarray(offset, end))
    offset = end
  }
  if (!removed) return false

  const rebuilt = Buffer.concat(frames)
  const body = Buffer.concat([rebuilt, Buffer.alloc(tagSize - rebuilt.length)])
  writeSync(fd, body, 0, body.length, 10)
  return true
}

/* ID3v1 注释字段只有 30 字节，网易云同样会写入被截断的 163 key；v1.1 的最后两字节是音轨号，保留。 */
function stripId3v1(fd: number, fileSize: number): boolean {
  if (fileSize < 128) return false
  const tag = readAt(fd, fileSize - 128, 128)
  if (tag.toString('latin1', 0, 3) !== 'TAG') return false
  if (!tag.toString('latin1', 97, 127).startsWith(NETEASE_KEY_PREFIX)) return false
  const hasTrack = tag[125] === 0 && tag[126] !== 0
  const length = hasTrack ? 28 : 30
  writeSync(fd, Buffer.alloc(length), 0, length, fileSize - 128 + 97)
  return true
}

/* 移除网易云 163 key 字段；返回 true 表示文件中存在并已删除。仅支持 FLAC 与带 ID3 标签的 MP3。 */
export function stripNeteaseKey(filePath: string): boolean {
  const fd = openSync(filePath, 'r+')
  try {
    if (readAt(fd, 0, 4).toString('latin1') === 'fLaC') return stripFlac(fd)
    const removedV2 = stripId3(fd)
    const removedV1 = stripId3v1(fd, fstatSync(fd).size)
    return removedV2 || removedV1
  } finally {
    closeSync(fd)
  }
}
