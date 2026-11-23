import { protocol } from 'electron'
import { basename, extname, join } from 'node:path'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { LibraryPaths } from './library/paths'
import { resolveMigratedAppendSource, resolveMigratedMusicSource } from './library/migratedAppendSources'

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ape': 'audio/x-ape'
}

// Chromium ignores Range when net.fetch forwards to file://, so serve byte ranges ourselves.
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'venas-media', privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

function streamForRequest(request: Request, filePath: string, options?: { start: number; end: number }): ReadableStream {
  const nodeStream = createReadStream(filePath, options)
  const abortStream = () => nodeStream.destroy()
  if (request.signal.aborted) abortStream()
  else request.signal.addEventListener('abort', abortStream, { once: true })
  nodeStream.once('close', () => request.signal.removeEventListener('abort', abortStream))
  return Readable.toWeb(nodeStream) as ReadableStream
}

// The host selects Music or Append; the URL path must contain only an encoded file name.
export function registerMediaProtocol(paths: LibraryPaths): void {
  protocol.handle('venas-media', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'music' && url.hostname !== 'append') return new Response(null, { status: 404 })

    let requestedFileName: string
    try {
      requestedFileName = decodeURIComponent(url.pathname.replace(/^\//, ''))
    } catch {
      return new Response(null, { status: 400 })
    }
    if (
      !requestedFileName ||
      requestedFileName === '.' ||
      requestedFileName === '..' ||
      basename(requestedFileName) !== requestedFileName ||
      /[/\\]/.test(requestedFileName)
    ) {
      return new Response(null, { status: 400 })
    }
    const migratedFileName = url.hostname === 'append' ? resolveMigratedAppendSource(requestedFileName) : null
    const renamedMusicFileName = url.hostname === 'music' ? resolveMigratedMusicSource(requestedFileName) : null
    const base = url.hostname === 'append' && !migratedFileName ? paths.append : paths.music
    const fileName = migratedFileName ?? renamedMusicFileName ?? requestedFileName
    if (!fileName || basename(fileName) !== fileName || /[/\\]/.test(fileName)) {
      return new Response(null, { status: 404 })
    }
    const filePath = join(base, fileName)
    const mimeType = AUDIO_MIME_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream'

    let fileSize: number
    try {
      fileSize = statSync(filePath).size
    } catch {
      return new Response(null, { status: 404 })
    }

    const rangeHeader = request.headers.get('range')
    if (!rangeHeader) {
      const stream = streamForRequest(request, filePath)
      return new Response(stream, {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': mimeType, 'Content-Length': String(fileSize), 'Accept-Ranges': 'bytes' }
      })
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
    if (!match) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } })
    }
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : fileSize - 1
    if (start >= fileSize || end >= fileSize || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } })
    }

    const stream = streamForRequest(request, filePath, { start, end })
    return new Response(stream, {
      status: 206,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': mimeType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
