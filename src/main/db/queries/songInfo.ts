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

/* 更新用户手动登记的初次聆听日期；song_info 记录理论上入库时已创建，这里仍用 UPSERT 兜底 */
export function setFirstHeardDate(db: Database.Database, songId: number, firstHeardDate: string | null): void {
  db.prepare(
    `INSERT INTO song_info (song_id, first_heard_date) VALUES (?, ?)
     ON CONFLICT(song_id) DO UPDATE SET first_heard_date = excluded.first_heard_date`
  ).run(songId, firstHeardDate)
}

/* 更新用户评分与评论；song_info 记录理论上入库时已创建，这里仍用 UPSERT 兜底 */
export function setScoreAndComment(
  db: Database.Database,
  songId: number,
  score: number | null,
  comment: string | null
): void {
  db.prepare(
    `INSERT INTO song_info (song_id, score, comment) VALUES (?, ?, ?)
     ON CONFLICT(song_id) DO UPDATE SET score = excluded.score, comment = excluded.comment`
  ).run(songId, score, comment)
}

/* 播放完成或超过阈值时更新 last_heard_date；song_info 记录理论上入库时已创建，这里仍用 UPSERT 兜底 */
export function touchLastHeard(db: Database.Database, songId: number): void {
  db.prepare(
    `INSERT INTO song_info (song_id, last_heard_date) VALUES (?, DATE('now', 'localtime'))
     ON CONFLICT(song_id) DO UPDATE SET last_heard_date = DATE('now', 'localtime')`
  ).run(songId)
}
