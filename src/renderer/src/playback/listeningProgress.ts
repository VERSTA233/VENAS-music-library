/* 仅保留累计秒数；跳转后的重复片段也累计，不存播放区间或定时写数据库。 */
export class ListeningProgress {
  seconds = 0

  add(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.seconds += seconds
  }

  reached(duration: number): boolean {
    return Number.isFinite(duration) && duration > 0 && this.seconds + 1e-6 >= duration * 0.6
  }
}

/* 流式播放同时核对媒体位置与单调时钟；快进跳跃不计入，暂停/缓冲事件切断采样。 */
export class StreamListeningClock {
  private previous: { clock: number; position: number; advancing: boolean } | null = null

  sample(clock: number, position: number, advancing: boolean): number {
    const previous = this.previous
    this.previous = { clock, position, advancing }
    if (!previous?.advancing || !Number.isFinite(position)) return 0
    const elapsed = Math.max(0, clock - previous.clock)
    const movement = position - previous.position
    if (movement < 0 || movement > elapsed + 0.25) return 0
    return Math.max(0, Math.min(elapsed, movement))
  }

  reset(): void {
    this.previous = null
  }
}
