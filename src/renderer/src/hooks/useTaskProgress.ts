import { useCallback, useEffect, useRef, useState } from 'react'

interface TaskProgress {
  revision: number
  status: string
}

interface TaskApi<T, U> {
  getProgress: () => Promise<T | null>
  subscribe: (receive: (progress: U) => void) => () => void
  start: () => Promise<T>
  cancel: () => Promise<T | null>
  merge?: (current: T, update: U) => T
}

/* 后台任务共用订阅、快照竞态保护和启停请求；切换页面只解绑监听，不停止任务。 */
export function useTaskProgress<T extends TaskProgress, U extends TaskProgress = T>({ getProgress, subscribe, start, cancel, merge }: TaskApi<T, U>) {
  const [progress, setProgress] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(false)
  const busy = progress?.status === 'running' || progress?.status === 'cancelling'
  const receive = useCallback((next: T | null): void => {
    if (active.current && next) setProgress(current => !current || next.revision >= current.revision ? next : current)
  }, [])

  useEffect(() => {
    active.current = true
    let disposed = false
    /* 增量事件不能替代完整快照；先暂存，再按 revision 回放，避免首次加载时漏掉旧问题。 */
    let pending: U[] | null = merge ? [] : null
    const apply = (current: T | null, next: U): T | null => {
      if (current && next.revision <= current.revision) return current
      return merge ? current ? merge(current, next) : null : next as unknown as T
    }
    const onProgress = (next: U): void => {
      if (disposed) return
      if (pending) pending.push(next)
      else setProgress(current => apply(current, next))
    }
    const unsubscribe = subscribe(onProgress)
    void getProgress().then(snapshot => {
      if (disposed) return
      const updates = pending ?? []
      pending = null
      setProgress(current => {
        let next = !current || (snapshot && snapshot.revision >= current.revision) ? snapshot : current
        for (const update of updates) next = apply(next, update)
        return next
      })
    }).catch(reason => {
      pending = null
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true; active.current = false; unsubscribe() }
  }, [getProgress, subscribe, merge])

  async function act(): Promise<void> {
    setRequesting(true); setError(null)
    try { receive(await (busy ? cancel() : start())) }
    catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (active.current) setRequesting(false) }
  }

  return { progress, loading, requesting, error, busy, act }
}
