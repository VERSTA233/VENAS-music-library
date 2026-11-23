/* 音频替换、删除与标签提交共用串行门，避免一边改标签一边换掉同一路径。读取与播放不等待。 */
class AudioFileOperations {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const pending = this.tail.then(operation)
    this.tail = pending.catch(() => undefined)
    return pending
  }
}

export const audioFileOperations = new AudioFileOperations()
