# VENAS 本地音乐库播放器

个人本地音乐库管理与播放软件，Electron + TypeScript + React + better-sqlite3。项目原始设计文档见 [`本地播放器搭建.md`](./本地播放器搭建.md)（⚠️ 部分内容已过时，见下方"文档与代码的差异"一节）。

本文档面向下一次新开的对话/开发会话，用于快速了解项目当前状态。

---

## 一、目前已完成的工作

### 1. 项目骨架
- Electron（electron-vite）+ TypeScript + React 三进程结构：`src/main`（主进程）、`src/preload`（预加载/IPC 桥）、`src/renderer`（渲染进程 UI）、`src/shared`（跨进程共享类型）。
- Tailwind CSS 做样式。Zustand 做渲染进程状态管理。
- `better-sqlite3` 存储元数据，`music-metadata` 解析音频标签，`sharp` 做封面压缩。
- 首次启动引导用户选择音乐根目录（`musicRoot`）与系统数据目录（`systemRoot`，可与音乐分盘存放），配置持久化在 `electron-store`（`src/main/settings.ts`）。
- 目录结构：`Music根/Append`（待入库暂存区）、`Music根/Music`（已入库音频文件）、`系统根/.system`（数据库、封面缓存、备份、日志等）。

### 2. 数据库
- 单文件 `SCHEMA_SQL` 建表（`src/main/db/schema.ts`），表：`artists`、`albums`、`songs`、`song_artists`、`album_songs`、`album_artists`、`tags`、`song_tags`、`song_info`，并建有 9 个外键索引。
- 厂牌（Label）复用 `artists` 表（`type='Label'`），不单独建表。
- WAL 模式 + 外键约束开启；每次打开数据库自动 `db.exec(SCHEMA_SQL)` 保证表结构存在。
- 自动备份：`src/main/library/backup.ts`，保留最近 3 份 `music_bak_YYYYMMDD.db`。

### 3. 入库（Append → Music）流程
- 扫描 `Append` 目录（`scanner.ts`），支持 `.mp3/.flac/.wav/.ogg/.m4a/.aac/.ape`，自动匹配同名 `.lrc` 歌词文件。
- 艺术家/曲名解析规则（`artistParser.ts`）：从括号中提取 `feat./ft./featuring` 标记为 Featured 艺术家，主体按 `/` 拆分为多个 Primary 艺术家，`title` 与 `artist` 两个来源分别解析后合并去重。
- 入库表单（`IngestModal.tsx` + `SongForm.tsx`）：填写标题、BPM、首次听到日期、歌词、艺术家（`ArtistPicker`）、专辑信息（`AlbumPicker`）、标签（`TagPicker`）。
- 入库时会创建 `song_info` 占位记录（记录音频文件本身的创建时间 `add_time`，而非入库操作时间）。
- 封面缓存系统（`coverCache.ts`）：统一压缩到 250KB 以内、最大 1000px，歌曲/专辑/艺术家封面共用同一套压缩策略；专辑封面来自入库时该曲目的内嵌图片，专辑首次建立后若之后追加曲目会做封面迁移（`moveSongPictureToAlbum`）。

### 4. 曲库浏览与播放
- **Music 视图**：分页（`PAGE_SIZE=50`）展示全部已入库歌曲，双击播放，"..." 打开编辑弹窗。
- **Artist 视图**：艺术家列表 → 详情页（含厂牌分组、旗下专辑/曲目）。
- **Album 视图**：专辑画廊（网格封面）→ 详情页，按 `disc_number/track_number` 严格升序展示曲目。
- 底部播放条（`BottomPlayerBar.tsx`）：播放/暂停/上一首/下一首、可拖拽进度条，全局空格键快捷键（`App.tsx` 中 `isTypingTarget()` 判断避免与输入框冲突），播放超过 60% 或播放完成时记录 `last_heard_date`。
- 播放走自定义特权协议 `venas-media://`（`src/main/index.ts` 注册），手动实现 HTTP Range/206 分段响应以支持拖拽进度条与大文件流式播放；封面图走单独的 IPC 二进制 → ObjectURL 方案（`Cover.tsx`），两者不复用同一套机制。
- 音频重载面板（`ReloadAudioPanel.tsx` + `reload.ts`）：用 `Music/` 目录内另一个文件替换当前歌曲的物理文件，仅重新提取时长与封面；提取失败时提示手动上传封面兜底。

### 5. 专辑重名去重（红绿黄三色匹配，最新完成）
背景问题：不同艺术家可能有同名专辑，旧逻辑 `findOrCreateAlbum` 仅按标题合并会导致误并库。现已彻底移除该函数，改为显式 `albumId` 选择模型：

- `AlbumPicker.tsx` 标题字段旁有三色指示灯：
  - 🔴 **红灯**：无同名已有专辑 → 保存时新建。
  - 🟡 **黄灯**：存在同名专辑但用户未从下拉框中明确选定 → 保存/入库前会弹出确认框，列出候选专辑（含艺术家名消歧），用户可选择"直接新建"或选定某个已有专辑。
  - 🟢 **绿灯**：已明确选定某已有专辑（或编辑已入库歌曲时该歌曲本身关联的专辑，视为隐式选定）→ 若表单字段与所选专辑原值不一致，保存前弹出"应用改动 / 不应用并还原"确认框。
- 核心逻辑封装在新文件 `AlbumSubmitGuard.tsx` 的 `useAlbumSubmitGuard()` hook 中：返回 `{ check, dialog }`，`check(album)` 返回一个 Promise，只有在用户与渲染出的确认框交互后才会 resolve（无需额外引入通用弹窗库）。
- 用户明确要求的行为：
  - 若在"应用改动"确认框中选择"不应用"，则把表单专辑字段重置为专辑原值，用户需再次点击保存。
  - 黄灯（同名但未选定）状态下直接保存 = 新建；若想使用已有专辑必须先在确认框里选定。
- 后端 `updateAlbumFields`（新增，`db/queries/albums.ts`）无条件覆盖已选定专辑的全部字段，取代了旧的"仅非空才合并"逻辑；`createAlbum` 用于新建。`ingest.ts` 与 `ipc/index.ts` 的 `songs:update` 处理器均按 `req.album.albumId != null ? updateAlbumFields : createAlbum` 分支。
- `searchAlbums` 现在返回 `AlbumMatchCandidate[]`（在 `AlbumRow` 基础上附带拼接好的艺术家名字符串，供去重下拉框展示辨认）。
- 已通过 `npm run typecheck` 验证（全绿，无报错）。

### 6. 艺术家/厂牌头像与封面
- `ArtistPicker.tsx`、`AlbumPicker.tsx` 的厂牌字段都复用红/绿两色匹配指示（基于 `artists.matchExact` IPC），逻辑比专辑标题的三色系统简单（无"存在但未选定"的中间态判断）。
- 艺术家头像、歌曲封面、专辑封面分别存放在 `assets/artist_pictures`、`assets/song_pictures`、`assets/album_pictures` 下（`paths.ts`），均支持手动上传覆盖（`setManualPicture`/`setManualCover` 系列 IPC）。

---

## 二、尚未完成 / 已知待办事项

- **`assets/ui` 目录仍是占位符**：`paths.ts` 中已预留 `assetsUi` 路径且会自动建目录，但目前没有任何读写它的业务逻辑，UI 主题/皮肤功能尚未实现。
- **标签体系（Tag）** 目前只有基础的搜索/按类型列出/新建（`db/queries/tags.ts`、`TagPicker.tsx`），`tag.md` 中列出的完整分类体系（Genre/Mood/Playlist/Scene/Chart/Theme/Work 等）尚未见有专门的批量导入或校验机制，需要确认是否要在下一阶段做标签库预置。
- **播放队列/播放列表** 目前 `playerStore.ts` 只支持"从当前列表播放一整个队列 + 上一首/下一首"，尚未见自建歌单（Playlist）功能的数据库表或 UI（`tag_type` 建议值里虽然有 `Playlist`，但那是作为 Tag 的一种类型，不等同于独立的播放列表功能）。
- **搜索/筛选能力有限**：目前各处搜索（`songs:list`、`artists:search`、`albums:search`、`tags:search`）都是简单的 `LIKE` 模糊匹配，没有全局搜索入口、没有组合筛选（按标签/评分/年代等）。
- **`song_info` 中的 `score`/`comment` 字段** 已有后端写入接口（`setScoreAndComment`），但未确认渲染层（`SongForm.tsx`/`SongEditModal.tsx`）是否已提供对应的评分/评论输入 UI —— 需要下一次会话核实。
- **无自动化测试**：项目目前没有任何 `*.test.ts` 文件，验证方式仅靠 `npm run typecheck` + 手动运行。
- **无 git 提交历史**：仓库 `main` 分支目前是 0 commits，全部文件都是 untracked 状态（`git status --short` 全部显示 `??`）。下一次会话可能需要先做首次提交。
- **规格文档本身已部分过时**，见下节。

### 文档与代码的差异（⚠️ 重要提醒）

`本地播放器搭建.md` 是项目最初的设计稿，**已经和实际代码出现偏差，不能直接当作当前实现的准确参考**，已知的过时之处：

1. 文档中描述的目录结构是旧版 `.system/images/{ui_themes,artists}` + `cache/images/`，实际代码（`paths.ts`）早已重构为 `assets/{artist_pictures,song_pictures,album_pictures,ui}` + `cache/{audio,waveforms}`。
2. 文档中 `artists` 表 SQL 仍包含 `artist_image TEXT` 字段，但该字段已在此前的重构中从真实 schema（`schema.ts`）中移除（艺术家头像现在是文件系统 + IPC 读取，不落库存路径）。
3. 专辑去重相关的红绿黄三色匹配逻辑（本文档"一、5"节）是最新加入的设计，原规格文档中未描述。

**建议**：下次会话如需查阅设计意图，优先信任本 README 与实际源码，规格文档仅作历史背景参考，涉及目录结构/表结构的具体细节请以 `src/main/db/schema.ts` 和 `src/main/library/paths.ts` 为准。

---

## 三、文件速览

### `src/shared/` — 跨进程共享类型
- **`types.ts`**：全部跨 main/preload/renderer 共享的 TypeScript 类型定义（`ArtistRow`、`AlbumRow`、`SongListItem`、`SongDetail`、`IngestAlbumInput`/`AlbumMatchCandidate` 等）。任何 IPC 参数/返回值改动通常都要先改这里。

### `src/main/` — 主进程
- **`index.ts`**：Electron 入口。注册 `venas-media://` 特权协议（含手动 HTTP Range/206 支持），`createWindow()`，`ensureLibraryRoot()`（首次启动选根目录 + 旧版 `libraryRoot` 迁移到 `musicRoot`/`systemRoot`），应用生命周期钩子。
- **`settings.ts`**：`electron-store` 持久化的 `AppSettings { musicRoot, systemRoot }`。
- **`db/index.ts`**：`openDatabase()`/获取当前实例，开启 WAL + 外键约束，执行 `SCHEMA_SQL`。
- **`db/schema.ts`**：全部建表 SQL（唯一权威 schema 来源）。
- **`db/queries/artists.ts`**：艺术家增删查（含厂牌复用 `type='Label'` 的 `findOrCreateLabelArtist`）。
- **`db/queries/labels.ts`**：厂牌专属查询（列表、详情，按厂牌分组展示旗下专辑/曲目）。
- **`db/queries/albums.ts`**：专辑增删查，`createAlbum`/`updateAlbumFields`（新，无条件覆盖）、`searchAlbums`（返回 `AlbumMatchCandidate[]`）、专辑-艺术家关联、专辑封面归属等。
- **`db/queries/songs.ts`**：歌曲增删查（`listSongs`/`countSongs`/`getSongDetail`/`createSong`/`updateSongFields`/`deleteSong`/`isFileNameTaken` 等）。
- **`db/queries/songInfo.ts`**：`song_info` 表读写（入库占位创建、首次听到日期、评分评论、`touchLastHeard`）。
- **`db/queries/tags.ts`**：标签搜索/按类型列出/新建。
- **`library/paths.ts`**：`libraryPaths()`，给定 `musicRoot`/`systemRoot` 推导出所有固定子目录绝对路径（唯一权威目录结构来源）。
- **`library/init.ts`**：确保音乐库全部固定子目录存在（不存在则创建）。
- **`library/scanner.ts`**：扫描 `Append` 目录，识别音频文件与同名歌词文件。
- **`library/artistParser.ts`**：艺术家/曲名解析规则（feat. 提取、`/` 拆分、Primary/Featured 排序）。
- **`library/ingest.ts`**：入库主逻辑，创建歌曲记录、专辑解析（`albumId` 分支：新建 or `updateAlbumFields`）、艺术家/标签关联、`song_info` 占位。
- **`library/coverCache.ts`**：封面压缩（≤250KB，最长边≤1000px）与写入（歌曲/专辑/艺术家共用同一压缩策略），含专辑封面迁移逻辑。
- **`library/reload.ts`**：用 `Music/` 内另一文件重载已入库歌曲的物理文件，重新提取时长/封面。
- **`library/backup.ts`**：数据库自动备份，保留最近 3 份。
- **`ipc/index.ts`**：全部 `ipcMain.handle` 注册处，是 main 进程功能的总入口（`append:*`、`songs:*`、`artists:*`、`albums:*`、`tags:*`、`playback:*`、`library:*` 等命名空间）。

### `src/preload/` — 预加载脚本
- **`index.ts`**：`contextBridge` 暴露 `window.api`，把 `ipcRenderer.invoke` 包装成带类型的方法，是 renderer 调用 main 进程功能的唯一入口。
- **`window.d.ts`**：给 `window.api` 补充全局类型声明。

### `src/renderer/src/` — 渲染进程 UI
- **`main.tsx`**：React 应用挂载入口。
- **`App.tsx`**：应用外壳。左侧导航（"文件空间"=Append/Music，"基础分类"=Artist/Album），根目录展示与切换，全局空格键播放/暂停快捷键。
- **`stores/navStore.ts`**：详情页跳转状态（`NavTarget`：跳到某艺术家/厂牌/专辑），以及"从 Music 列表跳转过去、返回时恢复滚动位置"的 `ReturnContext`。
- **`stores/playerStore.ts`**：播放队列状态（当前队列、当前下标、播放/暂停），`playQueue`/`togglePlay`/`playNext`/`playPrev`。
- **`stores/libraryStore.ts`**：Music 视图分页歌曲列表状态（`PAGE_SIZE=50`）。
- **`views/MusicView.tsx`**：Music 库分页列表视图，双击播放，"..." 打开编辑弹窗。
- **`views/AppendView.tsx`**：Append 暂存区列表，触发入库弹窗。
- **`views/ArtistView.tsx`**：艺术家列表 + 详情页（含厂牌分组）。
- **`views/AlbumView.tsx`**：专辑画廊网格 + 详情页（按 disc/track 排序曲目）。
- **`components/SongList.tsx`**：通用歌曲列表渲染组件（封面+时长格式化等），被多个视图复用。
- **`components/SongForm.tsx`**：歌曲编辑/入库共用表单（标题/BPM/首次听到日期/歌词/艺术家/专辑/标签字段的组装）。
- **`components/IngestModal.tsx`**：入库弹窗，包裹 `SongForm` + `useAlbumSubmitGuard` 确认流程。
- **`components/SongEditModal.tsx`**：已入库歌曲编辑弹窗，同样包裹 `SongForm` + `useAlbumSubmitGuard`，含重载音频面板入口。
- **`components/ArtistPicker.tsx`**：艺术家多选/新增控件（角色 Primary/Featured/Composer/... + 排序），红/绿两色精确匹配指示。
- **`components/AlbumPicker.tsx`**：专辑信息表单控件，标题字段红/黄/绿三色匹配指示（本项目最新完成的核心功能），厂牌字段红/绿两色指示；导出 `AlbumFormState`/`albumFieldsDirty`/`applyAlbumCandidate` 供 `AlbumSubmitGuard` 复用。
- **`components/AlbumSubmitGuard.tsx`**（新增）：`useAlbumSubmitGuard()` hook，封装专辑去重确认框（黄灯）与改动确认框（绿灯脏数据）两套 Promise 化弹窗交互逻辑。
- **`components/TagPicker.tsx`**：标签多选/新增控件（`tag_type` 建议值 + 自由输入）。
- **`components/Cover.tsx`**：通用封面缩略图组件，异步取二进制数据转 ObjectURL 展示，卸载/切换时释放旧 URL。
- **`components/BottomPlayerBar.tsx`**：底部播放条，播放/暂停/上下首/进度条拖拽，播放进度触发 `last_heard_date` 记录。
- **`components/ReloadAudioPanel.tsx`**：重载音频文件面板，选文件替换物理文件并重新提取元信息。

### 根目录其他文件
- **`本地播放器搭建.md`**：原始设计规格文档，**部分内容已过时**（见上文"文档与代码的差异"）。
- **`tag.md`**：Genre/Tag 分类体系参考列表（纯文档，非代码，尚未在系统中落地为预置数据）。
- **`electron.vite.config.ts`**：electron-vite 构建配置（main/preload/renderer 三部分，renderer 配了 `@renderer` 别名 + Tailwind postcss 插件）。
- **`package.json`**：项目名 `venas`，`productName: VENAS`，`version: 0.1.0`。关键依赖：`better-sqlite3`、`electron-store`、`music-metadata`、`react`、`zustand`、`sharp`；开发依赖：`electron`、`electron-vite`、`electron-builder`、`tailwindcss`、`typescript`。脚本：`dev`/`build`/`typecheck`/`postinstall`。

---

## 四、快速上手下一次会话

1. 验证代码正确性：`npm run typecheck`（同时检查 `tsconfig.node.json` 与 `tsconfig.web.json` 两个工程）。
2. 本地运行：`npm run dev`。
3. 数据库/目录结构以代码为准（`src/main/db/schema.ts`、`src/main/library/paths.ts`），不要直接信任 `本地播放器搭建.md` 中的旧描述。
4. 全局约定（用户长期偏好，务必遵守）：代码注释一律使用 `/* ... */` 块注释风格，**禁止** JSDoc 风格 `/** ... */`；对话中始终使用中文回复。
