// VENAS 音乐库数据库 schema
// 直接内嵌为字符串常量，避免打包时处理独立 .sql 资源文件的路径问题
// 关于枚举类字段：album_type / role / tag_type 不加 CHECK 约束（改用普通 TEXT），避免未来扩展新取值时需要做 SQLite 表重建迁移。
// 前端在 src/renderer/src/constants 中维护当前已知取值列表作为下拉选项，但输入框仍允许自由填入新值。

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('Person', 'Group', 'Label')),
    country TEXT,
    /* Group/Label 的有序成员 artist id，JSON number[]；空列表存 NULL。 */
    member_ids TEXT
);

/* SQLite 的 NOT NULL 接受空字符串；用触发器保护既有数据库与新建数据库，禁止空白艺术家名绕过应用层。 */
CREATE TRIGGER IF NOT EXISTS reject_empty_artist_name_on_insert
BEFORE INSERT ON artists
FOR EACH ROW WHEN length(trim(NEW.name)) = 0
BEGIN
    SELECT RAISE(ABORT, '艺术家名称不能为空');
END;

CREATE TRIGGER IF NOT EXISTS reject_empty_artist_name_on_update
BEFORE UPDATE OF name ON artists
FOR EACH ROW WHEN length(trim(NEW.name)) = 0
BEGIN
    SELECT RAISE(ABORT, '艺术家名称不能为空');
END;

CREATE TABLE IF NOT EXISTS artist_aliases (
    canonical_artist_id INTEGER NOT NULL,
    alias_artist_id INTEGER NOT NULL,
    alias_type TEXT,
    PRIMARY KEY (canonical_artist_id, alias_artist_id),
    UNIQUE (alias_artist_id),
    FOREIGN KEY (canonical_artist_id) REFERENCES artists(id) ON DELETE CASCADE,
    FOREIGN KEY (alias_artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    release_date TEXT,
    album_type TEXT,
    total_discs INTEGER,
    /* 仅供旧数据库迁移；新代码只读写 album_labels。 */
    label_id INTEGER,
    FOREIGN KEY (label_id) REFERENCES artists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS album_labels (
    album_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    label_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (album_id, label_id),
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    length INTEGER,
    /* 旧版本 BPM 遗留列：应用层已不再读取或写入，保留以兼容已有数据库。 */
    bpm INTEGER,
    lyric TEXT,
    file_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS song_artists (
    song_id INTEGER NOT NULL,
    artist_id INTEGER NOT NULL,
    role TEXT,
    artist_order INTEGER DEFAULT 0,
    PRIMARY KEY (song_id, artist_id, role),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS album_songs (
    album_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    disc_number INTEGER,
    track_number INTEGER,
    PRIMARY KEY (album_id, song_id),
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS album_artists (
    album_id INTEGER NOT NULL,
    artist_id INTEGER NOT NULL,
    artist_order INTEGER DEFAULT 0,
    PRIMARY KEY (album_id, artist_id),
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    tag_type TEXT,
    description TEXT,
    picture BLOB
);

CREATE TABLE IF NOT EXISTS song_tags (
    song_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    comment TEXT,
    PRIMARY KEY (song_id, tag_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS song_info (
    song_id INTEGER PRIMARY KEY,
    score INTEGER CHECK(score BETWEEN 0 AND 100),
    comment TEXT,
    first_heard_date TEXT,
    last_heard_date TEXT,
    add_time TEXT,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_song_artists_artist_id ON song_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_album_songs_song_id ON album_songs(song_id);
CREATE INDEX IF NOT EXISTS idx_album_artists_artist_id ON album_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_album_labels_label_id ON album_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_song_tags_tag_id ON song_tags(tag_id);
`
