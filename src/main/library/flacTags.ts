import { createHash } from 'node:crypto'
import { open, unlink, type FileHandle } from 'node:fs/promises'

interface MetadataBlock { type: number; data: Buffer }
interface FlacMetadata { blocks: MetadataBlock[]; audioOffset: number; size: number }

const MAX_BLOCK_LENGTH = 0xffffff
const MAX_METADATA_LENGTH = 128 * 1024 * 1024

async function readExactly(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset)
    if (!bytesRead) throw new Error('FLAC 文件不完整')
    offset += bytesRead
  }
  return buffer
}

async function readMetadata(file: FileHandle): Promise<FlacMetadata> {
  const { size } = await file.stat()
  if ((await readExactly(file, 0, 4)).toString('ascii') !== 'fLaC') throw new Error('文件不是原生 FLAC，未修改')
  const blocks: MetadataBlock[] = []
  let position = 4
  for (;;) {
    const header = await readExactly(file, position, 4)
    const type = header[0] & 0x7f
    const length = header.readUIntBE(1, 3)
    if (type === 127 || position + 4 + length > size || position + 4 + length > MAX_METADATA_LENGTH) {
      throw new Error('FLAC 元数据块无效或过大')
    }
    if (blocks.length === 0 ? type !== 0 || length !== 34 : type === 0) throw new Error('FLAC STREAMINFO 无效')
    blocks.push({ type, data: await readExactly(file, position + 4, length) })
    position += 4 + length
    if (header[0] & 0x80) break
  }
  if (position === size) throw new Error('FLAC 缺少音频数据')
  if (blocks.filter((block) => block.type === 4).length > 1) throw new Error('FLAC 包含重复的注释块，未修改')
  return { blocks, audioOffset: position, size }
}

function decodeComments(data: Buffer): { vendor: Buffer; entries: Buffer[] } {
  let position = 0
  function uint32(): number {
    if (position + 4 > data.length) throw new Error('Vorbis Comment 长度无效')
    const result = data.readUInt32LE(position)
    position += 4
    return result
  }
  function bytes(length: number): Buffer {
    if (position + length > data.length) throw new Error('Vorbis Comment 内容不完整')
    const result = data.subarray(position, position + length)
    position += length
    return result
  }
  const vendor = bytes(uint32())
  const count = uint32()
  if (count > Math.floor((data.length - position) / 4)) throw new Error('Vorbis Comment 数量无效')
  const entries = Array.from({ length: count }, () => bytes(uint32()))
  if (position !== data.length) throw new Error('Vorbis Comment 存在无法识别的尾部数据')
  return { vendor, entries }
}

function encodeComments(vendor: Buffer, entries: Buffer[]): Buffer {
  function uint32(value: number): Buffer {
    const result = Buffer.alloc(4)
    result.writeUInt32LE(value)
    return result
  }
  const length = 8 + vendor.length + entries.reduce((sum, entry) => sum + 4 + entry.length, 0)
  if (length > MAX_BLOCK_LENGTH) throw new Error('写入内容超过 FLAC 注释块容量')
  return Buffer.concat([uint32(vendor.length), vendor, uint32(entries.length), ...entries.flatMap((entry) => [uint32(entry.length), entry])], length)
}

function updateComments(blocks: MetadataBlock[], tags: Record<string, string>): { blocks: MetadataBlock[]; removedDescriptions: number } {
  const replacements = new Map<string, string>()
  for (const [key, value] of Object.entries(tags)) {
    const name = key.toUpperCase()
    const clearAlbumField = value === '' && (name === 'ALBUM' || name === 'ALBUMARTIST')
    if (!/^[\x20-\x3c\x3e-\x7d]+$/.test(name) || name === 'DESCRIPTION' || typeof value !== 'string' || (!value.trim() && !clearAlbumField)) {
      throw new Error(`不允许写入的标签：${key}`)
    }
    replacements.set(name, value)
  }
  const original = blocks.find((block) => block.type === 4)
  const { vendor, entries } = original ? decodeComments(original.data) : { vendor: Buffer.from('VENAS'), entries: [] }
  let removedDescriptions = 0
  const kept = entries.filter((entry) => {
    const separator = entry.indexOf(0x3d)
    if (separator < 1) throw new Error('Vorbis Comment 字段缺少名称或等号')
    const name = entry.toString('ascii', 0, separator).toUpperCase()
    const value = entry.toString('utf8', separator + 1)
    if (name === 'DESCRIPTION' && value.includes('163 key')) {
      removedDescriptions++
      return false
    }
    return !replacements.has(name)
  })
  for (const [name, value] of replacements) if (value !== '') kept.push(Buffer.from(`${name}=${value}`, 'utf8'))
  const updated = { type: 4, data: encodeComments(vendor, kept) }
  return {
    blocks: original ? blocks.map((block) => block === original ? updated : block) : [...blocks, updated],
    removedDescriptions
  }
}

async function writeAll(file: FileHandle, data: Buffer): Promise<void> {
  let offset = 0
  while (offset < data.length) {
    const { bytesWritten } = await file.write(data, offset, data.length - offset)
    if (!bytesWritten) throw new Error('FLAC 文件写入未完成')
    offset += bytesWritten
  }
}

async function audioHash(file: FileHandle, metadata: FlacMetadata, destination?: FileHandle): Promise<string> {
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(1024 * 1024)
  for (let position = metadata.audioOffset; position < metadata.size;) {
    const length = Math.min(buffer.length, metadata.size - position)
    const { bytesRead } = await file.read(buffer, 0, length, position)
    if (!bytesRead) throw new Error('FLAC 音频数据读取中断')
    const chunk = buffer.subarray(0, bytesRead)
    hash.update(chunk)
    if (destination) await writeAll(destination, chunk)
    position += bytesRead
  }
  return hash.digest('hex')
}

interface FlacTagWriteResult {
  audioSha256: string
  preservedMetadataSha256: string
  removedDescriptions: number
  tags: Record<string, string[]>
}

function preservedHash(blocks: MetadataBlock[]): string {
  const hash = createHash('sha256')
  for (const block of blocks.filter((block) => block.type !== 4)) {
    const header = Buffer.alloc(4)
    header[0] = block.type
    header.writeUIntBE(block.data.length, 1, 3)
    hash.update(header).update(block.data)
  }
  return hash.digest('hex')
}

/* 仅写入新的临时文件；逐字节保留音频、封面及其他元数据块，校验成功后由调用方决定替换。 */
export async function writeFlacTagCopy(source: string, destination: string, tags: Record<string, string>): Promise<FlacTagWriteResult> {
  const input = await open(source, 'r')
  let output: FileHandle | null = null
  let created = false
  try {
    const metadata = await readMetadata(input)
    const updated = updateComments(metadata.blocks, tags)
    output = await open(destination, 'wx', 0o600)
    created = true
    await writeAll(output, Buffer.from('fLaC'))
    for (const [index, block] of updated.blocks.entries()) {
      const header = Buffer.alloc(4)
      header[0] = block.type | (index === updated.blocks.length - 1 ? 0x80 : 0)
      header.writeUIntBE(block.data.length, 1, 3)
      await writeAll(output, header)
      await writeAll(output, block.data)
    }
    const originalAudioHash = await audioHash(input, metadata, output)
    await output.sync()
    await output.close()
    output = null
    const verified = await open(destination, 'r')
    try {
      const actual = await readMetadata(verified)
      if (preservedHash(metadata.blocks) !== preservedHash(actual.blocks)) throw new Error('FLAC 封面或其他元数据校验失败')
      const actualAudioHash = await audioHash(verified, actual)
      if (originalAudioHash !== actualAudioHash) throw new Error('FLAC 音频数据校验失败')
      const comments = actual.blocks.find((block) => block.type === 4)!
      const expected = updated.blocks.find((block) => block.type === 4)!
      if (!comments.data.equals(expected.data)) throw new Error('FLAC 标签校验失败')
      const values: Record<string, string[]> = {}
      for (const entry of decodeComments(comments.data).entries) {
        const separator = entry.indexOf(0x3d)
        const name = entry.toString('ascii', 0, separator).toUpperCase()
        ;(values[name] ??= []).push(entry.toString('utf8', separator + 1))
      }
      return { audioSha256: actualAudioHash, preservedMetadataSha256: preservedHash(actual.blocks), removedDescriptions: updated.removedDescriptions, tags: values }
    } finally {
      await verified.close()
    }
  } catch (error) {
    if (output) { await output.close(); output = null }
    if (created) await unlink(destination).catch(() => undefined)
    throw error
  } finally {
    await input.close()
  }
}
