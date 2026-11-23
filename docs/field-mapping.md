# 标签映射说明

艺术家保留数据库顺序，不区分角色。多值用 `/` 拼接。歌词保留完整 LRC、时间戳与换行。写入时会覆盖数据库有值的字段，保留未指定字段。

| 数据库信息        | FLAC                 | MP3 / WAV（ID3v2.4） |
| ------------ | -------------------- | ------------------ |
| 曲名           | TITLE                | TIT2               |
| 歌曲艺术家        | ARTIST               | TPE1               |
| 专辑           | ALBUM                | TALB               |
| 专辑发行日期       | DATE                 | TDRC               |
| 音轨号          | TRACKNUMBER          | TRCK               |
| 碟号 / 总碟数     | DISCNUMBER、DISCTOTAL | TPOS，例如 1/2        |
| Genre 类型 Tag | GENRE                | TCON               |
| Mood 类型 Tag  | MOOD                 | TMOO               |
| 专辑艺术家        | ALBUMARTIST          | TPE2               |
| 厂牌           | LABEL                | TXXX:LABEL         |
| Work 类型 Tag  | WORK                 | TXXX:WORK          |
| Theme 类型 Tag | GROUPING             | GRP1               |
| 歌词           | LYRICS               | USLT               |
| 歌曲评论         | COMMENT              | COMM               |
| 专辑类型         | RELEASETYPE          | TXXX:RELEASETYPE   |

`TDRC` 在 Mp3tag 中对应 YEAR；`USLT` / `LYRICS` 对应 UNSYNCEDLYRICS。`GRP1` 按已确认的兼容方案保留，它是扩展帧，ID3v2.4 官方内容分组帧为 `TIT1`。OGG 写入仅支持单逻辑流 Vorbis，不包含 Opus、链式或多流 OGG。

注释规则：MP3 仅清理包含字面量 `163 key` 的 COMM 与 ID3v1 comment；数据库评论非空时用 UTF-8 COMM（语言 `und`、空描述）覆盖全部 COMM。FLAC 仅清理包含 `163 key` 的 DESCRIPTION，数据库评论非空时覆盖 COMMENT。数据库评论为空或纯空白时保留普通评论。WAV、OGG、M4A 不执行 `163 key` 清理；WAV 保留未指定修改的 INFO / BEXT / iXML 块。网易云导入的 `neteaseTags.ts` 有不同清理职责，不能直接复用。
