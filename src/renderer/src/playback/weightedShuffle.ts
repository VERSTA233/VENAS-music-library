/* 按本地日历日计算间隔，避免夏令时让一天变成 23/25 小时。 */
export function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
}

export function playbackWeight(lastHeard: string | null | undefined, now = new Date()): number {
  if (!lastHeard) return 4
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastHeard)
  if (!match) return 4
  const [, year, month, day] = match.map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return 4
  const days = Math.max(0, calendarDay(now) - calendarDay(date))
  return 1 + 3 * days / (days + 14)
}

/* 指数随机键产生无放回的加权排列。禁用首曲时先在其余歌曲中抽首曲，再排列剩余歌曲。 */
export function weightedOrder(weights: number[], excludedFirst: number | null = null, random = Math.random): number[] {
  let first: number | null = null
  if (weights.length > 1 && excludedFirst != null) {
    const total = weights.reduce((sum, weight, index) => sum + (index === excludedFirst ? 0 : weight), 0)
    let target = random() * total
    for (let index = 0; index < weights.length; index++) {
      if (index === excludedFirst) continue
      target -= weights[index]
      first = index
      if (target < 0) break
    }
  }
  const ranked = weights.flatMap((weight, index) => index === first ? [] : [{ index, key: -Math.log(Math.max(Number.MIN_VALUE, 1 - random())) / weight }])
  ranked.sort((a, b) => a.key - b.key)
  return [...(first == null ? [] : [first]), ...ranked.map((item) => item.index)]
}

export function isPermutation(order: number[] | undefined, length: number): order is number[] {
  return !!order && order.length === length && new Set(order).size === length
    && order.every((index) => Number.isInteger(index) && index >= 0 && index < length)
}
