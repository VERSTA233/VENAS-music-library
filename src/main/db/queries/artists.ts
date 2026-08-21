import type Database from 'better-sqlite3'
import type { ArtistAliasOf, ArtistAliasType, ArtistRow, ArtistListItem, SongListItem } from '../../../shared/types'
import { withArtistNames } from './songList'

export type { ArtistRow }

function parseMemberIds(value: string | null): number[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
  } catch {
    return []
  }
}

function serializeMemberIds(ids: number[]): string | null {
  return ids.length > 0 ? JSON.stringify(ids) : null
}

function isTeamType(type: string | null): boolean {
  return type === 'Group' || type === 'Label'
}

function memberIdsByArtist(db: Database.Database): Map<number, number[]> {
  const rows = db
    .prepare<[], { id: number; member_ids: string | null }>(
      "SELECT id, member_ids FROM artists WHERE type IN ('Group', 'Label') AND member_ids IS NOT NULL"
    )
    .all()
  return new Map(rows.map((row) => [row.id, parseMemberIds(row.member_ids)]))
}

function assertAcyclicMemberships(membersByArtist: Map<number, number[]>): void {
  const visiting = new Set<number>()
  const visited = new Set<number>()

  function visit(artistId: number): void {
    if (visiting.has(artistId)) throw new Error('团队成员关系不能形成循环')
    if (visited.has(artistId)) return
    visiting.add(artistId)
    for (const memberId of membersByArtist.get(artistId) ?? []) {
      if (membersByArtist.has(memberId)) visit(memberId)
    }
    visiting.delete(artistId)
    visited.add(artistId)
  }

  for (const artistId of membersByArtist.keys()) visit(artistId)
}

function normalizedMemberIds(db: Database.Database, artistId: number, memberIds: number[]): number[] {
  const normalized = [...new Set(memberIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (normalized.includes(artistId)) throw new Error('团队不能将自己设为成员')
  if (normalized.length === 0) return []

  const placeholders = normalized.map(() => '?').join(', ')
  const rows = db
    .prepare<number[], { id: number; type: string | null }>(
      `SELECT id, type FROM artists WHERE id IN (${placeholders})`
    )
    .all(...normalized)
  if (rows.length !== normalized.length) throw new Error('成员中包含不存在的艺术家')
  if (rows.some((row) => row.type === 'Label')) throw new Error('厂牌不能作为其他团队的成员')

  const graph = memberIdsByArtist(db)
  graph.set(artistId, normalized)
  assertAcyclicMemberships(graph)
  return normalized
}

function replaceMemberReferences(db: Database.Database, sourceArtistId: number, targetArtistId: number | null): void {
  const teams = db
    .prepare<[], { id: number; member_ids: string | null }>(
      "SELECT id, member_ids FROM artists WHERE type IN ('Group', 'Label') AND member_ids IS NOT NULL"
    )
    .all()
  if (targetArtistId != null) {
    const target = getArtistById(db, targetArtistId)
    if (target?.type === 'Label' && teams.some((team) => parseMemberIds(team.member_ids).includes(sourceArtistId))) {
      throw new Error('厂牌不能作为其他团队的成员')
    }
  }
  const replacements = new Map<number, number[]>()
  for (const team of teams) {
    const current = parseMemberIds(team.member_ids)
    if (!current.includes(sourceArtistId)) continue
    const next = current
      .flatMap((id) => id === sourceArtistId && targetArtistId != null ? [targetArtistId] : id === sourceArtistId ? [] : [id])
      .filter((id, index, ids) => id !== team.id && ids.indexOf(id) === index)
    replacements.set(team.id, next)
  }

  const graph = memberIdsByArtist(db)
  for (const [teamId, ids] of replacements) graph.set(teamId, ids)
  assertAcyclicMemberships(graph)
  const update = db.prepare('UPDATE artists SET member_ids = ? WHERE id = ?')
  for (const [teamId, ids] of replacements) update.run(serializeMemberIds(ids), teamId)
}

function requireArtistName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('艺术家名称不能为空')
  return normalized
}

/* 按主艺名精确匹配（忽略大小写），无匹配返回 null。 */
export function findArtistByName(db: Database.Database, name: string): ArtistRow | null {
  const normalizedName = requireArtistName(name)
  const row = db
    .prepare<[string, string], ArtistRow>(
      `SELECT * FROM artists
       WHERE trim(name) = ? COLLATE NOCASE AND (type IS NULL OR type <> 'Label')
       ORDER BY CASE WHEN name = ? COLLATE NOCASE THEN 0 ELSE 1 END, id ASC
       LIMIT 1`
    )
    .get(normalizedName, normalizedName)
  return row ?? null
}

/* 厂牌仍存储在 artists 表中，但厂牌输入只能匹配 type='Label' 的记录。 */
export function findLabelByName(db: Database.Database, name: string): ArtistRow | null {
  const normalizedName = requireArtistName(name)
  const row = db
    .prepare<[string, string], ArtistRow>(
      `SELECT * FROM artists
       WHERE trim(name) = ? COLLATE NOCASE AND type = 'Label'
       ORDER BY CASE WHEN name = ? COLLATE NOCASE THEN 0 ELSE 1 END, id ASC
       LIMIT 1`
    )
    .get(normalizedName, normalizedName)
  return row ?? null
}

/* 兼容历史数据库中意外写入的前后空格；保持 artist_id 不变，避免丢失歌曲/专辑关联。 */
function normalizeStoredArtistName(db: Database.Database, artistId: number): void {
  db.prepare('UPDATE artists SET name = trim(name) WHERE id = ? AND name <> trim(name)').run(artistId)
}

export function createArtist(db: Database.Database, name: string, type: string | null = null): number {
  const info = db.prepare('INSERT INTO artists (name, type) VALUES (?, ?)').run(requireArtistName(name), type)
  return Number(info.lastInsertRowid)
}

/*
 * 查找已有艺术家，不存在则创建，返回 artist_id。
 * type 仅在新建时写入（对应前端红灯场景下用户指定的 Person/Group）；已匹配到已有艺术家时忽略该参数，不覆盖其原有 type。
 */
export function findOrCreateArtist(db: Database.Database, name: string, type: string | null = null): number {
  const normalizedName = requireArtistName(name)
  const existing = findArtistByName(db, normalizedName)
  if (existing) {
    normalizeStoredArtistName(db, existing.id)
    return existing.id
  }
  return createArtist(db, normalizedName, type)
}

/*
 * 厂牌本质上也是一个 artist（type='Label'），复用同一张 artists 表而不是单独建厂牌表。
 * 只复用已有 Label；与普通艺术家同名时创建独立记录，避免两类实体互相污染。
 */
export function findOrCreateLabelArtist(db: Database.Database, name: string): number {
  const normalizedName = requireArtistName(name)
  const existingLabel = findLabelByName(db, normalizedName)
  if (existingLabel) {
    normalizeStoredArtistName(db, existingLabel.id)
    return existingLabel.id
  }
  /* 普通艺术家（包括 type 为空）可以与厂牌同名；两者语义不同，保留为独立记录。 */
  return createArtist(db, normalizedName, 'Label')
}

/* 编辑弹窗保存名称、Type/国家；厂牌调用时不传 type，从而保留 Label 类型。 */
export function updateArtistInfo(
  db: Database.Database,
  artistId: number,
  name: string,
  type: 'Person' | 'Group' | null | undefined,
  country: string | null,
  memberIds: number[] = []
): void {
  const normalizedName = requireArtistName(name)
  db.transaction(() => {
    const current = getArtistById(db, artistId)
    if (!current) throw new Error('艺术家不存在')
    const nextType = type === undefined ? current.type : type
    const nextMemberIds = isTeamType(nextType) ? normalizedMemberIds(db, artistId, memberIds) : []
    const result = type === undefined
      ? db.prepare('UPDATE artists SET name = ?, country = ?, member_ids = ? WHERE id = ?')
        .run(normalizedName, country, serializeMemberIds(nextMemberIds), artistId)
      : db.prepare('UPDATE artists SET name = ?, type = ?, country = ?, member_ids = ? WHERE id = ?')
        .run(normalizedName, type, country, serializeMemberIds(nextMemberIds), artistId)
    if (result.changes === 0) throw new Error('艺术家不存在')
  })()
}

export function getArtistMembers(db: Database.Database, artistId: number): ArtistRow[] {
  const artist = getArtistById(db, artistId)
  const ids = parseMemberIds(artist?.member_ids ?? null)
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare<number[], ArtistRow>(`SELECT * FROM artists WHERE id IN (${placeholders})`).all(...ids)
  const byId = new Map<number, ArtistRow>(rows.map((row): [number, ArtistRow] => [row.id, row]))
  const members: ArtistRow[] = []
  for (const id of ids) {
    const member = byId.get(id)
    if (member) members.push(member)
  }
  return members
}

export function isArtistMember(db: Database.Database, artistId: number): boolean {
  const teams = db
    .prepare<[], { member_ids: string | null }>(
      "SELECT member_ids FROM artists WHERE type IN ('Group', 'Label') AND member_ids IS NOT NULL"
    )
    .all()
  return teams.some((team) => parseMemberIds(team.member_ids).includes(artistId))
}

/* 删除艺术家记录；外键会同步解除关联表，member_ids 中的非外键引用在同一事务内清理。 */
export function deleteArtistRecord(db: Database.Database, artistId: number): void {
  db.transaction(() => {
    replaceMemberReferences(db, artistId, null)
    const result = db.prepare('DELETE FROM artists WHERE id = ?').run(artistId)
    if (result.changes === 0) throw new Error('艺术家不存在')
  })()
}

/*
 * 合并时保留目标艺术家已有关系：相同歌曲且角色相同、或相同专辑的记录不会重复写入。
 * 除歌曲关系外，专辑艺术家和厂牌引用也一并转移，避免删除源艺术家后丢失专辑资料。
 */
export function mergeArtistRecords(db: Database.Database, sourceArtistId: number, targetArtistId: number): void {
  if (sourceArtistId === targetArtistId) throw new Error('不能合并到当前艺术家')
  const source = getArtistById(db, sourceArtistId)
  const target = getArtistById(db, targetArtistId)
  if (!source) throw new Error('当前艺术家不存在')
  if (!target) throw new Error('目标艺术家不存在')
  const sourceMemberIds = parseMemberIds(source.member_ids)
  if (sourceMemberIds.length > 0 && !isTeamType(target.type)) {
    throw new Error('有成员的团队只能合并到 Group 或 Label')
  }

  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO song_artists (song_id, artist_id, role, artist_order)
       SELECT song_id, ?, role, artist_order FROM song_artists WHERE artist_id = ?`
    ).run(targetArtistId, sourceArtistId)
    db.prepare(
      `INSERT OR IGNORE INTO album_artists (album_id, artist_id, artist_order)
       SELECT album_id, ?, artist_order FROM album_artists WHERE artist_id = ?`
    ).run(targetArtistId, sourceArtistId)
    db.prepare(
      `INSERT OR IGNORE INTO album_labels (album_id, label_id, label_order)
       SELECT album_id, ?, label_order FROM album_labels WHERE label_id = ?`
    ).run(targetArtistId, sourceArtistId)
    replaceMemberReferences(db, sourceArtistId, targetArtistId)
    if (sourceMemberIds.length > 0) {
      const targetMemberIds = parseMemberIds(getArtistById(db, targetArtistId)?.member_ids ?? null)
      const mergedMemberIds = normalizedMemberIds(
        db,
        targetArtistId,
        [...targetMemberIds, ...sourceMemberIds].filter((id) => id !== sourceArtistId && id !== targetArtistId)
      )
      db.prepare('UPDATE artists SET member_ids = ? WHERE id = ?')
        .run(serializeMemberIds(mergedMemberIds), targetArtistId)
    }
    const result = db.prepare('DELETE FROM artists WHERE id = ?').run(sourceArtistId)
    if (result.changes === 0) throw new Error('当前艺术家不存在')
  })()
}

/* B 作为 A 的别名仍保留在 artists 中，歌曲继续直接关联 B。 */
export function setArtistAlias(
  db: Database.Database,
  aliasArtistId: number,
  canonicalArtistId: number,
  aliasType: ArtistAliasType
): void {
  if (aliasArtistId === canonicalArtistId) throw new Error('不能将艺术家设为自身的别名')
  const alias = getArtistById(db, aliasArtistId)
  const canonical = getArtistById(db, canonicalArtistId)
  if (!alias || !canonical) throw new Error('艺术家不存在')
  if (alias.type === 'Label' || canonical.type === 'Label') throw new Error('厂牌不能参与艺术家别名关联')

  const aliasHasChildren = db
    .prepare<[number], { present: number }>('SELECT 1 AS present FROM artist_aliases WHERE canonical_artist_id = ? LIMIT 1')
    .get(aliasArtistId)
  if (aliasHasChildren) throw new Error('已有其他别名归属于当前艺术家，不能再将它设为别名')

  const canonicalIsAlias = db
    .prepare<[number], { present: number }>('SELECT 1 AS present FROM artist_aliases WHERE alias_artist_id = ? LIMIT 1')
    .get(canonicalArtistId)
  if (canonicalIsAlias) throw new Error('目标艺术家本身是别名，不能作为主艺名')

  try {
    db.prepare(
      'INSERT INTO artist_aliases (canonical_artist_id, alias_artist_id, alias_type) VALUES (?, ?, ?)'
    ).run(canonicalArtistId, aliasArtistId, aliasType)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new Error('当前艺术家已经关联到一个主艺名')
    }
    throw error
  }
}

export function getArtistAliasOf(db: Database.Database, artistId: number): ArtistAliasOf | null {
  const row = db
    .prepare<[number], ArtistAliasOf>(
      `SELECT ar.id AS id, ar.name AS name, aa.alias_type AS aliasType
       FROM artist_aliases aa
       JOIN artists ar ON ar.id = aa.canonical_artist_id
       WHERE aa.alias_artist_id = ?`
    )
    .get(artistId)
  return row ?? null
}

export function searchArtists(db: Database.Database, query: string): ArtistRow[] {
  return db
    .prepare<[string], ArtistRow>(
      "SELECT * FROM artists WHERE (type IS NULL OR type <> 'Label') AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 20"
    )
    .all(`%${query}%`)
}

export function searchLabels(db: Database.Database, query: string): ArtistRow[] {
  return db
    .prepare<[string], ArtistRow>(
      "SELECT * FROM artists WHERE type = 'Label' AND name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 20"
    )
    .all(`%${query}%`)
}

/*
 * Artist 星云第一层网格数据源：排除 type='Label' 的记录（厂牌本质上复用 artists 表存储，
 * 但不属于用户浏览意义上的"艺术家"，不应出现在这个星云里），附带关联曲目数量，按名称排序。
 */
export function listArtists(db: Database.Database): ArtistListItem[] {
  return db
    .prepare<[], ArtistListItem>(
      `SELECT ar.*, COUNT(DISTINCT sa.song_id) AS songCount
       FROM artists ar
       LEFT JOIN song_artists sa ON sa.artist_id = ar.id
         OR sa.artist_id IN (
           SELECT aa.alias_artist_id
           FROM artist_aliases aa
           WHERE aa.canonical_artist_id = ar.id
         )
       WHERE ar.type IS NOT 'Label'
       GROUP BY ar.id
       ORDER BY ar.name COLLATE NOCASE`
    )
    .all()
}

export function getArtistById(db: Database.Database, artistId: number): ArtistRow | null {
  const row = db.prepare<[number], ArtistRow>('SELECT * FROM artists WHERE id = ?').get(artistId)
  return row ?? null
}

/* 某艺术家（含 Featured/Composer 等角色）关联的全部曲目，按曲名排序，供 Artist 详情页展示 */
export function getArtistSongs(db: Database.Database, artistId: number): SongListItem[] {
  const rows = db
    .prepare<
      [number],
      { id: number; title: string; length: number | null; file_name: string; add_time: string | null }
    >(
      `SELECT DISTINCT s.id AS id, s.title AS title, s.length AS length, s.file_name AS file_name, si.add_time AS add_time
       FROM song_artists sa JOIN songs s ON s.id = sa.song_id
       LEFT JOIN song_info si ON si.song_id = s.id
       WHERE sa.artist_id = ?
          OR sa.artist_id IN (
            SELECT aa.alias_artist_id
            FROM artist_aliases aa
            WHERE aa.canonical_artist_id = ?
          )
       ORDER BY s.title COLLATE NOCASE`
    )
    .all(artistId, artistId)

  return withArtistNames(db, rows)
}

/* 随机返回艺术家关联曲目的封面来源；调用方只读对应歌曲/专辑封面，不会生成艺术家头像缓存。 */
export function getArtistCoverCandidates(
  db: Database.Database,
  artistId: number
): { songId: number; albumId: number | null }[] {
  return db
    .prepare<[number, number, number], { songId: number; albumId: number | null }>(
      `WITH candidates AS (
         SELECT sa.song_id AS songId, als.album_id AS albumId
         FROM song_artists sa
         LEFT JOIN album_songs als ON als.song_id = sa.song_id
         WHERE sa.artist_id = ?
            OR sa.artist_id IN (
              SELECT aa.alias_artist_id
              FROM artist_aliases aa
              WHERE aa.canonical_artist_id = ?
            )
         UNION
         SELECT als.song_id AS songId, als.album_id AS albumId
         FROM album_labels abl
         JOIN album_songs als ON als.album_id = abl.album_id
         WHERE abl.label_id = ?
       )
       SELECT DISTINCT songId, albumId
       FROM candidates
       ORDER BY RANDOM()`
    )
    .all(artistId, artistId, artistId)
}
