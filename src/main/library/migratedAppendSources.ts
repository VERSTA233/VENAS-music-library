/*
 * Append 音频入库后，当前 <audio> 可能仍持有 append URL 并继续发起 Range 请求。
 * 这份映射只在本次应用运行期间存在；会话持久化始终使用正式的 Music URL。
 */
const migratedAppendSources = new Map<string, string>()
const migratedMusicSources = new Map<string, string>()

export function recordMigratedAppendSource(appendFileName: string, musicFileName: string): void {
  migratedAppendSources.set(appendFileName, musicFileName)
}

export function resolveMigratedAppendSource(appendFileName: string): string | null {
  return migratedAppendSources.get(appendFileName) ?? null
}

/*
 * 编辑歌曲时改名后，当前 <audio> 仍可能以旧 Music URL 请求后续 Range。
 * 连续改名会把所有旧入口压到最终文件名；改回旧名时先清掉该入口，避免形成环。
 */
export function recordMigratedMusicSource(oldFileName: string, newFileName: string): void {
  if (oldFileName === newFileName) return

  migratedMusicSources.delete(newFileName)
  for (const [source, target] of migratedMusicSources) {
    if (target === oldFileName) migratedMusicSources.set(source, newFileName)
  }
  migratedMusicSources.set(oldFileName, newFileName)
}

export function resolveMigratedMusicSource(musicFileName: string): string | null {
  return migratedMusicSources.get(musicFileName) ?? null
}
