import type { LibraryMaintenanceState } from '../../shared/types'

/* 所有库操作共用入口：迁移先等待在途操作结束，维护期间的新请求挂起，恢复后才继续。 */
export class LibraryMaintenance {
  state: LibraryMaintenanceState | null = null
  private active = new Set<Promise<unknown>>()
  private resume: (() => void) | null = null
  private paused: Promise<void> | null = null

  constructor(private readonly publish: (state: LibraryMaintenanceState | null) => void) {}

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    while (this.paused) await this.paused
    const pending = Promise.resolve().then(operation)
    this.active.add(pending)
    try {
      return await pending
    } finally {
      this.active.delete(pending)
    }
  }

  async begin(): Promise<void> {
    if (this.paused) throw new Error('系统目录正在迁移，请等待完成')
    this.paused = new Promise<void>((resolve) => { this.resume = resolve })
    this.update({ phase: 'waiting', completed: 0, total: 0 })
    await Promise.allSettled([...this.active])
  }

  update(state: LibraryMaintenanceState): void {
    this.state = state
    this.publish(state)
  }

  finish(): void {
    this.state = null
    this.paused = null
    this.resume?.()
    this.resume = null
    this.publish(null)
  }
}
