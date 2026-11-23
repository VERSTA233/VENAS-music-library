import { createHash } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'

/* 哈希 / 解码前后核对同一份文件；不能只看 mtime，否则原子替换可能被遗漏。 */
export function isSameAudioFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

export async function hashAudioFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  return hash.digest('hex')
}
