# VENAS 本地音乐库播放器

个人本地音乐库管理与播放软件，Electron + TypeScript + React + better-sqlite3。

---

## 从 GitHub 克隆后运行

本节面向一台从未安装开发环境的新 macOS 或 Windows 电脑。项目含有 `better-sqlite3` 和 `sharp` 两个原生依赖，必须在目标系统、目标 CPU 架构上重新安装；不要复制另一台电脑的 `node_modules`。

### 运行结果与范围

完成下文步骤后，执行 `npm run dev` 即可启动可用的 VENAS 桌面程序。首次启动会要求选择：

- **音乐目录**：其下应有或将自动创建 `Append/` 和 `Music/`。
- **系统目录**：其下会创建 `.system/`，存放数据库、封面和配置；其中数据库位于 `.system/database/`。建议选择一个稳定且有写入权限的位置。

若只需要在另一台电脑上运行软件，按本节的源码运行步骤即可。若需要生成无需 Node.js 环境即可安装的应用，请继续阅读下方“打包为可安装应用”。

### macOS：从零运行

适用于 Apple Silicon 和 Intel Mac；请在目标 Mac 本机执行，`npm ci` 会下载对应架构的 Electron 与原生模块。

1. 安装 Xcode Command Line Tools。在“终端”执行，并在系统弹窗中完成安装：
   
   ```bash
   xcode-select --install
   ```

2. 安装 Node.js 22 LTS。前往 [Node.js 官网](https://nodejs.org/) 下载 macOS Installer 并安装。重新打开终端后确认：
   
   ```bash
   node -v
   npm -v
   ```
   
   `node -v` 应显示 `v22` 或更高的 LTS 版本。

3. 克隆仓库并进入目录：
   
   ```bash
   git clone https://github.com/VERSTA233/VENAS-music-library
   cd MusicLib
   ```
   
   若系统提示没有 `git`，重新执行第一步并重开终端。

4. 安装锁定版本的依赖。此命令会自动执行 `postinstall`，为当前 macOS 和 Electron 版本准备 `better-sqlite3`、`sharp`：
   
   ```bash
   npm ci
   ```

5. 验证并启动：
   
   ```bash
   npm run typecheck
   npm run dev
   ```
   
   出现 VENAS 窗口即表示启动成功。终端必须保持运行；按 `Ctrl+C` 可结束程序。

### Windows：从零运行

建议使用 Windows 10/11 64 位系统，并在 Windows 本机执行。不要在 macOS 上生成的 `node_modules` 或 `out/` 目录复制过来。

1. 安装以下工具：
   
   - [Git for Windows](https://git-scm.com/download/win)，安装时保持默认选项即可。
   
   - [Node.js 22 LTS](https://nodejs.org/)，安装时勾选加入 `PATH`。
   
   - [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，在工作负载中勾选 **Desktop development with C++**。
   
   - Python 3。可从 [python.org](https://www.python.org/downloads/windows/) 安装，并勾选 **Add Python to PATH**。
   
   后两项用于原生模块没有可用预编译包时的本地编译；即便本次安装没有触发编译，也建议保留。

2. 打开 PowerShell，确认 Node 可用：
   
   ```powershell
   node -v
   npm -v
   ```

3. 克隆仓库并进入项目目录：
   
   ```powershell
   git clone https://github.com/VERSTA233/VENAS-music-library
   Set-Location MusicLib
   ```

4. 安装依赖。不要添加 `--ignore-scripts`，否则原生依赖不会为 Windows/Electron 正确准备：
   
   ```powershell
   npm ci
   ```

5. 验证并启动：
   
   ```powershell
   npm run typecheck
   npm run dev
   ```

### 构建后启动

若需要验证生产构建而不是开发服务器，可在完成依赖安装后执行：

```bash
npm run build
npx electron .
```

Windows PowerShell 使用相同命令。该方式仍依赖项目目录和 `node_modules`，不是独立安装器。

## 打包为可安装应用

项目已包含 `electron-builder`。打包前必须在目标操作系统、目标 CPU 架构的电脑上重新执行 `npm ci`，让 `better-sqlite3` 与 `sharp` 安装匹配该平台的原生模块。不要复用其他电脑的 `node_modules` 或 `out/`。

所有安装包会写入项目根目录下的 `dist/`。打包前建议先执行一次类型检查：

```bash
npm run typecheck
```

### macOS：生成 DMG

请在 macOS 本机打包。Apple Silicon Mac 生成 Apple Silicon 安装包：

```bash
npm run build
npx electron-builder --mac dmg --arm64 --publish never
```

Intel Mac 改用：

```bash
npm run build
npx electron-builder --mac dmg --x64 --publish never
```

完成后在 `dist/` 中取得 `.dmg` 文件；同目录的 `mac-arm64/` 或 `mac/` 是解包后的应用目录，适合在发布前直接测试。当前项目未配置 Apple Developer 证书、公证或签名，因此首次打开未签名 DMG 内的应用时，macOS 可能要求在 Finder 中按住 Control 点击应用后选择“打开”。正式分发前应配置 Developer ID 签名与 notarization。

### Windows：生成安装程序

请在 Windows x64 本机的 PowerShell 中打包：

```powershell
npm run build
npx electron-builder --win nsis --x64 --publish never
```

完成后在 `dist/` 中取得 `*Setup*.exe` 安装程序；`dist/win-unpacked/` 是无需安装、可直接运行的测试版本。当前项目未配置 Windows 代码签名证书，首次分发时 Windows SmartScreen 可能显示信誉警告；正式公开发布前应添加 Authenticode 签名。

### 跨平台说明

不要在 macOS 上直接产出 Windows 安装程序，也不要在 Windows 上直接产出 macOS DMG。虽然 `electron-builder` 提供跨平台参数，但本项目包含原生依赖，跨平台构建还会引入目标架构预编译模块、Windows 安装器工具链或 macOS 签名等额外问题。最稳定的流程是在对应系统本机构建；自动化发布时使用 GitHub Actions 的 macOS 与 Windows runner 分别执行相同命令。

### 常见问题

- **`better-sqlite3` 或 `sharp` 安装失败**：确认 Node 为 LTS，删除当前电脑上的 `node_modules` 后重新执行 `npm ci`，并保留仓库中的 `package-lock.json`；Windows 还需确认 C++ Build Tools 和 Python 已安装，并重开 PowerShell。
- **Electron 下载失败**：检查网络、代理和企业防火墙设置后重试 `npm ci`。不要把另一台电脑下载的 Electron 或原生 `.node` 文件直接混用。
- **应用打不开或音频不能播放**：先执行 `npm run typecheck`；再在目标机器上用 `npm run dev` 查看终端错误。音频解码由目标机器上 Electron 自带 Chromium 完成，需在 Windows 实机验证实际使用的 MP3、FLAC、M4A 等格式。
- **首次启动后的数据库在哪里**：由首次选择的系统目录决定，实际位置为 `<系统目录>/.system/database/music.db`；迁移目录请在应用的“设置”页面进行，不要手动移动运行中的数据库文件。

## 二、尚未完成 / 已知待办事项

- **播放队列/播放列表** 目前 `playerStore.ts` 只支持"从当前列表播放一整个队列 + 上一首/下一首"，尚未见自建歌单（Playlist）功能的数据库表或 UI（`tag_type` 建议值里虽然有 `Playlist`，但那是作为 Tag 的一种类型，不等同于独立的播放列表功能）。
- **搜索/筛选能力有限**：目前各处搜索（`songs:list`、`artists:search`、`albums:search`、`tags:search`）都是简单的 `LIKE` 模糊匹配，没有全局搜索入口、没有组合筛选（按标签/评分/年代等）。

- **无 git 提交历史**：仓库 `main` 分支目前是 0 commits，全部文件都是 untracked 状态（`git status --short` 全部显示 `??`）。下一次会话可能需要先做首次提交。

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
- **`stores/libraryStore.ts`**：Music 视图完整歌曲列表状态，负责排序、搜索与刷新。
- **`views/MusicView.tsx`**：Music 库完整列表视图，双击播放，"..." 打开编辑弹窗。
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
- **`package.json`**：项目名 `venas`，`productName: VENAS`，`version: 0.1.0`。关键依赖：`better-sqlite3`、`electron-store`、`music-metadata`、`react`、`zustand`、`sharp`；开发依赖：`electron`、`electron-vite`、`electron-builder`、`tailwindcss`、`typescript`。脚本：`dev`/`build`/`typecheck`/`postinstall`；安装包通过 `npx electron-builder` 生成。

---

## 四、快速上手下一次会话

1. 验证代码正确性：`npm run typecheck`（同时检查 `tsconfig.node.json` 与 `tsconfig.web.json` 两个工程）。
2. 本地运行：`npm run dev`。
3. 数据库/目录结构以代码为准（`src/main/db/schema.ts`、`src/main/library/paths.ts`），不要直接信任 `本地播放器搭建.md` 中的旧描述。
4. 全局约定（用户长期偏好，务必遵守）：代码注释一律使用 `/* ... */` 块注释风格，**禁止** JSDoc 风格 `/** ... */`；对话中始终使用中文回复。
