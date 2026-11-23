// Container inspection shared by the runtime worker and independent format tests.
import { createHash } from 'node:crypto'

export function syncsafe(bytes, offset) {
  if (offset + 4 > bytes.length || bytes.subarray(offset, offset + 4).some(value => value > 127)) throw new Error('Invalid ID3 size')
  return (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3]
}

export function wavChunks(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Unsupported WAV container')
  const end = bytes.readUInt32LE(4) + 8
  if (end !== bytes.length) throw new Error('WAV RIFF length mismatch')
  const chunks = []
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated WAV chunk')
    const size = bytes.readUInt32LE(offset + 4)
    const next = offset + 8 + size + (size % 2)
    if (next > end) throw new Error('Invalid WAV chunk size')
    chunks.push({ id: bytes.toString('latin1', offset, offset + 4), data: bytes.subarray(offset + 8, offset + 8 + size) })
    offset = next
  }
  return chunks
}

function id3Bytes(bytes, format) {
  if (format === 'wav') return wavChunks(bytes).find(chunk => chunk.id.toLowerCase() === 'id3 ')?.data
  return bytes.subarray(0, 3).toString() === 'ID3' ? bytes : undefined
}

export function id3Frames(bytes, format) {
  const tag = id3Bytes(bytes, format)
  if (!tag) return []
  if (tag[3] !== 4 || tag[5] !== 0) throw new Error('Test output is not plain ID3v2.4')
  const frames = []
  const end = 10 + syncsafe(tag, 6)
  if (end > tag.length) throw new Error('Truncated ID3 tag')
  for (let offset = 10; offset + 10 <= end && tag[offset] !== 0;) {
    const id = tag.toString('ascii', offset, offset + 4)
    const size = syncsafe(tag, offset + 4)
    if (!/^[A-Z0-9]{4}$/.test(id) || !size || offset + 10 + size > end) throw new Error('Invalid ID3 frame')
    frames.push({ id, body: tag.subarray(offset + 10, offset + 10 + size) })
    offset += 10 + size
  }
  return frames
}

export function frameText(body) {
  const payload = body.subarray(1)
  if (body[0] === 3) return payload.toString('utf8').replace(/\0+$/, '')
  if (body[0] === 0) return payload.toString('latin1').replace(/\0+$/, '')
  let data = Buffer.from(payload)
  if (body[0] === 2 || data[0] === 0xfe && data[1] === 0xff) data = data.swap16()
  return data.toString('utf16le').replace(/^\uFEFF/, '').replace(/\0+$/, '')
}

export function inspectId3Tags(bytes, format) {
  const tags = {}
  for (const frame of id3Frames(bytes, format)) {
    let key = frame.id
    let value
    if (key === 'TXXX') {
      const text = frameText(frame.body)
      const separator = text.indexOf('\0')
      key = `TXXX:${text.slice(0, separator)}`
      value = text.slice(separator + 1).replace(/^\uFEFF/, '')
    } else if (key === 'USLT' || key === 'COMM') {
      const text = frameText(Buffer.concat([frame.body.subarray(0, 1), frame.body.subarray(4)]))
      value = text.slice(text.indexOf('\0') + 1).replace(/^\uFEFF/, '')
    } else if (key.startsWith('T') || key === 'GRP1') value = frameText(frame.body)
    else continue
    ;(tags[key] ??= []).push(value)
  }
  return tags
}

export function encodedMediaHash(bytes, format, ignoreWavAlbum = false) {
  const hash = createHash('sha256')
  if (format === 'ogg') {
    for (const packet of oggPackets(bytes)) {
      // Vorbis comment packet is the only packet permitted to change.
      if (packet[0] === 3 && packet.toString('ascii', 1, 7) === 'vorbis') continue
      const length = Buffer.alloc(4); length.writeUInt32LE(packet.length)
      hash.update(length).update(packet)
    }
  } else if (format === 'm4a') {
    let found = false
    for (const atom of mp4Atoms(bytes)) if (atom.type === 'mdat') { hash.update(atom.data); found = true }
    if (!found) throw new Error('M4A 缺少 mdat')
  } else if (format === 'wav') {
    // TagLib 保存 INFO 时可移动 LIST 块；允许清空 IPRD 时按块名比较其余内容。
    const chunks = wavChunks(bytes)
    if (ignoreWavAlbum) chunks.sort((a, b) => a.id.localeCompare(b.id))
    for (const chunk of chunks) if (chunk.id.toLowerCase() !== 'id3 ') {
      if (ignoreWavAlbum && chunk.id === 'LIST' && chunk.data.toString('ascii', 0, 4) === 'INFO') {
        const fields = []
        for (let offset = 4; offset < chunk.data.length;) {
          if (offset + 8 > chunk.data.length) throw new Error('Truncated WAV INFO field')
          const id = chunk.data.toString('ascii', offset, offset + 4)
          const size = chunk.data.readUInt32LE(offset + 4)
          const end = offset + 8 + size + (size % 2)
          if (end > chunk.data.length) throw new Error('Invalid WAV INFO field size')
          if (id !== 'IPRD') fields.push({ id, data: chunk.data.subarray(offset + 8, offset + 8 + size) })
          offset = end
        }
        for (const field of fields.sort((a, b) => a.id.localeCompare(b.id))) hash.update(`INFO:${field.id}`).update(field.data)
      } else hash.update(chunk.id).update(chunk.data)
    }
  } else {
    const from = bytes.toString('ascii', 0, 3) === 'ID3' ? 10 + syncsafe(bytes, 6) + (bytes[3] === 4 && bytes[5] & 0x10 ? 10 : 0) : 0
    const to = bytes.toString('ascii', bytes.length - 128, bytes.length - 125) === 'TAG' ? bytes.length - 128 : bytes.length
    hash.update(bytes.subarray(from, to))
  }
  return hash.digest('hex')
}

export function oggPackets(bytes) {
  const packets = [], pieces = []
  let serial
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 27 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'OggS' || bytes[offset + 4] !== 0) throw new Error('Invalid Ogg page')
    const pageSerial = bytes.readUInt32LE(offset + 14)
    serial ??= pageSerial
    if (serial !== pageSerial) throw new Error('暂不支持链式或多逻辑流 Ogg，未修改原文件')
    const segments = bytes[offset + 26]
    let body = offset + 27 + segments
    if (body > bytes.length) throw new Error('Truncated Ogg segments')
    for (let i = 0; i < segments; i++) {
      const size = bytes[offset + 27 + i]
      if (body + size > bytes.length) throw new Error('Truncated Ogg packet')
      pieces.push(bytes.subarray(body, body + size)); body += size
      if (size < 255) { packets.push(Buffer.concat(pieces)); pieces.length = 0 }
    }
    offset = body
  }
  if (pieces.length) throw new Error('Incomplete Ogg packet')
  if (packets[0]?.[0] !== 1 || packets[0].toString('ascii', 1, 7) !== 'vorbis') throw new Error('目前仅支持 Ogg Vorbis，未修改原文件')
  return packets
}

export function mp4Atoms(bytes, start = 0, end = bytes.length) {
  const atoms = []
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated MP4 atom')
    let size = bytes.readUInt32BE(offset), header = 8
    if (size === 1) {
      if (offset + 16 > end) throw new Error('Truncated MP4 extended atom')
      const extended = bytes.readBigUInt64BE(offset + 8)
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized MP4 atom')
      size = Number(extended); header = 16
    }
    if (size === 0) size = end - offset
    if (size < header || offset + size > end) throw new Error('Invalid MP4 atom size')
    atoms.push({ type: bytes.toString('latin1', offset + 4, offset + 8), data: bytes.subarray(offset + header, offset + size) })
    offset += size
  }
  return atoms
}

export function inspectMp4Tags(bytes) {
  const moov = mp4Atoms(bytes).find(a => a.type === 'moov')
  const udta = moov && mp4Atoms(moov.data).find(a => a.type === 'udta')
  const meta = udta && mp4Atoms(udta.data).find(a => a.type === 'meta')
  const ilst = meta && mp4Atoms(meta.data, 4).find(a => a.type === 'ilst')
  if (!ilst) return {}
  const tags = {}
  for (const atom of mp4Atoms(ilst.data)) {
    const children = mp4Atoms(atom.data)
    let key = atom.type
    if (key === '----') key += ':' + ['mean', 'name'].map(id => children.find(c => c.type === id)?.data.subarray(4).toString('utf8')).join(':')
    for (const data of children.filter(c => c.type === 'data')) {
      if (data.data.length < 8) throw new Error('Truncated MP4 data')
      const payload = data.data.subarray(8)
      let value
      if (key === 'trkn' || key === 'disk') {
        if (payload.length < 6) throw new Error('Truncated MP4 track/disc')
        value = [payload.readUInt16BE(2), payload.readUInt16BE(4)]
      } else if (data.data.readUInt32BE(0) === 1) value = payload.toString('utf8')
      else value = payload.toString('hex')
      ;(tags[key] ??= []).push(value)
    }
  }
  return tags
}


