// 艺术家/曲名解析规则：
// 1. 先从原字符串中提取"仅限括号内"的 feat. 标记：
//      (feat. X) / [feat. X] / (ft. X) / (featuring X)  —— 不区分大小写
// 2. 括号内内容按 `,` 和 `&` 拆分为多个 Featured 艺术家
// 3. 从原字符串中移除整个括号片段，剩余主体按 `/` 拆分为多个 Primary 艺术家
// 4. 排序：Primary 在前（按拆分顺序 0..n），Featured 紧随其后
//
// 该函数对 title 和 artist 两个来源字段分别调用，上层负责合并去重。

import type { ParsedArtist } from '../../shared/types'

export type { ParsedArtist }

export interface ParseResult {
  /* 剔除 feat. 片段后的清洗文本（用于 title 来源时得到干净曲名） */
  cleanedText: string
  artists: ParsedArtist[]
}

const FEAT_PATTERN = /[([]\s*(?:feat\.|ft\.|featuring)\s*([^)\]]+)[)\]]/i

/*
 * extractPrimary 为 false 时（曲名字段场景），剩余主体文本不作为 Primary 艺术家输出——
 * 曲名去掉 feat. 片段后剩下的就是纯曲名本身，不是艺术家名，只有括号内的 feat. 才是真正的艺术家信息。
 */
export function parseArtists(raw: string | null | undefined, extractPrimary = true): ParseResult {
  if (!raw || !raw.trim()) return { cleanedText: '', artists: [] }

  const source = raw.trim()
  const match = source.match(FEAT_PATTERN)

  let primaryPart = source
  const featured: string[] = []

  if (match) {
    const featContent = match[1]
    featured.push(
      ...featContent
        .split(/[,&]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
    primaryPart = (source.slice(0, match.index) + source.slice((match.index ?? 0) + match[0].length)).trim()
  }

  const primary = extractPrimary
    ? primaryPart
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const artists: ParsedArtist[] = [
    ...primary.map((name, i) => ({ name, role: 'Primary' as const, order: i })),
    ...featured.map((name, i) => ({ name, role: 'Featured' as const, order: primary.length + i }))
  ]

  return { cleanedText: primaryPart, artists }
}

/* 合并 title 来源和 artist 字段来源解析出的艺术家列表：按 name 忽略大小写去重，保留先出现的 role/order */
export function mergeParsedArtists(...lists: ParsedArtist[][]): ParsedArtist[] {
  const seen = new Map<string, ParsedArtist>()
  for (const list of lists) {
    for (const a of list) {
      const key = a.name.toLowerCase()
      if (!seen.has(key)) seen.set(key, a)
    }
  }
  // 重新按 Primary 优先、再按各自 order 排序，最终统一编号
  const merged = Array.from(seen.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === 'Primary' ? -1 : 1
    return a.order - b.order
  })
  return merged.map((a, i) => ({ ...a, order: i }))
}
