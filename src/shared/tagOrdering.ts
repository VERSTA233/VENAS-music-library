function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function parseYear(name: string): number | null {
  const match = /^(\d{4})$/.exec(name.trim())
  return match ? Number(match[1]) : null
}

function parseMonth(name: string): [year: number, month: number] | null {
  const match = /^(\d{4})\.(\d{1,2})$/.exec(name.trim())
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return [Number(match[1]), month]
}

/* 普通 Tag 按名称排序；Month/Year 是时间标签，按实际时间而非数字文本排序。 */
export function orderTagsForDisplay<T extends { name: string }>(items: T[], tagType: string): T[] {
  const normalizedType = tagType.trim().toLocaleLowerCase('en-US')
  if (normalizedType === 'month') {
    return [...items].sort((a, b) => {
      const left = parseMonth(a.name)
      const right = parseMonth(b.name)
      if (left && right) return left[0] - right[0] || left[1] - right[1] || compareNames(a.name, b.name)
      if (left) return -1
      if (right) return 1
      return compareNames(a.name, b.name)
    })
  }

  if (normalizedType === 'year') {
    return [...items].sort((a, b) => {
      const left = parseYear(a.name)
      const right = parseYear(b.name)
      if (left != null && right != null) return left - right || compareNames(a.name, b.name)
      if (left != null) return -1
      if (right != null) return 1
      return compareNames(a.name, b.name)
    })
  }

  return [...items].sort((a, b) => compareNames(a.name, b.name))
}
