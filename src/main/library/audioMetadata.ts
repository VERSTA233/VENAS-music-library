import { extname } from 'node:path'
import { parseFile, type IAudioMetadata, type IOptions } from 'music-metadata'

/* Ogg 标签和封面可跨越许多页。默认快速模式在第 12 页附近停止，可能截断大封面；
 * 显式读到末页，尤其适用于 TagLib 更新标签、重新分页后的文件。 */
export function parseAudioMetadata(file: string, options: IOptions = {}): Promise<IAudioMetadata> {
  return parseFile(file, extname(file).toLowerCase() === '.ogg' ? { ...options, duration: true } : options)
}
