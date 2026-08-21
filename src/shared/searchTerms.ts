import { toHiragana, toKatakana } from 'wanakana'

/*
 * 搜索使用同一套词项生成规则，供主进程 SQL 查询和渲染层本地筛选共用。
 * wanakana 会转换部分标点（例如 `/` -> `・`），纯标点查询不应因此产生额外匹配。
 */
export function buildSearchTerms(query: string): string[] {
  const source = query.trim()
  if (!source) return []

  const terms = [source]
  /* 只有包含文字/数字时才生成平假名、片假名变体；原始查询始终保留。 */
  if (/[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/u.test(source)) {
    terms.push(toKatakana(source), toHiragana(source))
  }

  return [...new Set(terms.map((term) => term.toLocaleLowerCase()))]
}
