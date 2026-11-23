import type Database from 'better-sqlite3'

/*
 * 入库时创建 song_info 占位记录：song_id / add_time 必有值，first_heard_date 由用户在表单中手动登记（可留空），其余字段为 NULL。
 * add_time 记录的是音频文件本身的修改时间（由调用方从文件系统读取后传入），而不是执行入库操作的时刻，
 * 这样即便某首歌很久之后才被整理进音乐库，add_time 依然反映它实际"到手"的时间。
 */
export function createSongInfoOnIngest(
  db: Database.Database,
  songId: number,
  addTime: string,
  firstHeardDate: string | null,
  score: number | null,
  comment: string | null
): void {
  db.prepare(
    'INSERT INTO song_info (song_id, add_time, first_heard_date, score, comment) VALUES (?, ?, ?, ?, ?)'
  ).run(songId, addTime, firstHeardDate, score, comment)
}

/* 编辑歌曲时一次保存用户信息；不覆盖入库时间与最近播放日期。 */
export function updateSongInfo(
  db: Database.Database,
  songId: number,
  data: { firstHeardDate: string | null; score: number | null; comment: string | null }
): void {
  db.prepare(
    `INSERT INTO song_info (song_id, first_heard_date, score, comment) VALUES (?, ?, ?, ?)
     ON CONFLICT(song_id) DO UPDATE SET first_heard_date = excluded.first_heard_date,
       score = excluded.score, comment = excluded.comment`
  ).run(songId, data.firstHeardDate, data.score, data.comment)
}

/* 实际累计聆听达到阈值后更新日期；返回数据库采用的本地日期，供随机权重立即同步。 */
export function touchLastHeard(db: Database.Database, songId: number): string {
  db.prepare(
    `INSERT INTO song_info (song_id, last_heard_date) VALUES (?, DATE('now', 'localtime'))
     ON CONFLICT(song_id) DO UPDATE SET last_heard_date = DATE('now', 'localtime')`
  ).run(songId)
  return db.prepare<[number], { last_heard_date: string }>('SELECT last_heard_date FROM song_info WHERE song_id = ?').get(songId)!.last_heard_date
}

/* 一次查询全部已有播放记录；无记录的歌曲由前端赋默认权重。 */
export function getLastHeardDates(db: Database.Database): { songId: number; date: string }[] {
  return db.prepare<[], { songId: number; date: string }>(
    'SELECT song_id AS songId, last_heard_date AS date FROM song_info WHERE last_heard_date IS NOT NULL'
  ).all()
}
