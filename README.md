# VENAS 本地音乐库播放器

本系统为本地音乐库管理与播放软件，主要优化了音乐库的整理，搭配了简易的歌词显示和可视化。

---

## 功能简介

- 对曲目添加艺术家、专辑、歌词、Tags、评分、评论等信息。

- 一首曲目可以添加多个 Tags，方便按照 Genre、Mood 等特征进行整理。

- 对于有歌词的音频，可以在全屏播放界面显示歌词，并跳转到指定歌词的位置。对于无歌词的音频，系统实时读取音频信息，显示音频频谱。

- 系统主要根据 Artist、Album、Tags 进行分类。Artist 和 Album 可在对应主页编辑信息。

- 软件可以接入网易云音乐 NCM 文件破解文件，在下载歌曲后一键解码。

---

## 音乐库目录结构

首次打开软件时选择一个音乐库根目录，系统会将它同时用作音乐目录和系统目录。之后可在 **Settings → 存储位置** 中分别调整。

“音乐目录”指 `Append/`、`Music/` 的父目录，“系统目录”指 `.system/` 的父目录。

### 音乐目录

```text
<音乐目录>/
├── Append/                          # 待入库音频
│   ├── 艺术家 - 歌名.flac
│   ├── 艺术家 - 歌名.mp3
│   └── 艺术家 - 歌名.lrc             # 可自动匹配同名音频的歌词
└── Music/                           # 音乐库音频
    ├── 艺术家 - 歌名.flac
    ├── 艺术家 - 歌名.mp3
    └── Playlist/                    # 手动生成后出现
        ├── Genre/                   # Tag 类型
        │   └── Ambient.m3u          # 对应 Tag 的歌单
        ├── Mood/
        │   └── Sorrow.m3u
        └── 未分类/
            └── 某个未分类标签.m3u
```

文件需要先放入 Append 文件夹中，在系统中填写信息后由软件移动并建立数据库记录。

### 系统目录

```text
<系统目录>/
└── .system/                         # 隐藏目录，保存音乐库数据
    ├── database/
    │   ├── music.db                 # 歌曲、艺术家、专辑、Tag、关联与任务状态
    │   ├── music.db-wal             # SQLite 运行时生成的预写日志
    │   ├── music.db-shm             # SQLite 运行时生成的共享内存文件
    │   └── backups/
    │       └── music_bak_YYYYMMDD.db # 启动时按日期备份，最多保留最近 3 份
    ├── assets/
    │   ├── artist_pictures/
    │   │   └── <艺术家ID>.jpg         # 艺术家 / 厂牌上传的头像
    │   ├── album_pictures/
    │   │   └── <专辑ID>.jpg           # 专辑封面缓存，同专辑曲目共享
    │   └── song_pictures/
    │       └── <歌曲ID>.jpg           # 无专辑歌曲的独立封面缓存
    └── tools/                        # 用户另行放入的工具
        └── ncmdump                  # 如 NCM 解码工具
```

目录和数据库会自动创建。例如，音乐目录和系统目录都选择 `/Users/你的用户名/Music/VENAS` 时，实际数据库路径为：

```text
/Users/你的用户名/Music/VENAS/.system/database/music.db
```

### 应用设置与任务临时目录

目录选择、音量、播放队列、播放进度及导航会话保存在 Electron 用户数据目录的 `config.json`。默认路径为：

```text
macOS:   ~/Library/Application Support/<应用名>/config.json
Windows: %APPDATA%\<应用名>\config.json
```

---

## 项目构建

### macOS

适用于 Apple Silicon 和 Intel Mac

1. 安装 Xcode Command Line Tools。
   
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
   git clone https://github.com/VERSTA233/VENAS-music-library MusicLib
   cd MusicLib
   ```

4. 安装锁定版本的依赖。此命令会自动执行 `postinstall`，为当前 macOS 和 Electron 版本准备 `better-sqlite3`、`sharp`：
   
   ```bash
   npm ci
   ```

5. 安装Homebrew，按 [Homebrew 官网](https://brew.sh/) 完成安装。

6. 安装标签写入器的构建依赖。
   
   ```bash
   brew install taglib pkg-config
   ```

7. 验证并启动：
   
   ```bash
   npm run typecheck
   npm run dev
   ```
   
   出现 VENAS 窗口即表示启动成功。

### Windows

建议使用 Windows 10/11 64 位系统，并在 Windows 本机执行。不要在 macOS 上生成的 `node_modules` 或 `out/` 目录复制过来。

1. 安装以下工具：
   
   - [Git for Windows](https://git-scm.com/download/win)，安装时保持默认选项即可。
   
   - [Node.js 22 LTS](https://nodejs.org/)，安装时勾选加入 `PATH`。
   
   - [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，在工作负载中勾选 **Desktop development with C++**。
   
   - Python 3。可从 [python.org](https://www.python.org/downloads/windows/) 安装，并勾选 **Add Python to PATH**。
   
   后两项用于原生模块没有可用预编译包时的本地编译；即便本次安装没有触发编译，也建议保留。
   
   标签写入器另外需要 [MSYS2](https://www.msys2.org/) 的 UCRT64 工具链。在 **MSYS2 UCRT64** 终端执行：
   
   ```bash
   pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-taglib mingw-w64-ucrt-x86_64-pkgconf make tar curl
   ```
   
   将 `C:\msys64\ucrt64\bin` 与 `C:\msys64\usr\bin` 加到开发终端的 PATH，然后重开 PowerShell。构建脚本使用 C++17 / TagLib 2.x，将写入器和所需 DLL 一起打包；已处理 UTF-16 文件路径与 UTF-8 标签。Windows 构建路径尚未在 Windows 实机验证。

2. 打开 PowerShell，确认 Node 可用：
   
   ```powershell
   node -v
   npm -v
   ```

3. 克隆仓库并进入项目目录：
   
   ```powershell
   git clone https://github.com/VERSTA233/VENAS-music-library MusicLib
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

### 打包为应用

所有安装包会写入项目根目录下的 `dist/`。打包前建议先执行一次类型检查：

```bash
npm run typecheck
```

#### macOS

Apple Silicon Mac：

```bash
npm run build
npx electron-builder --mac dmg --arm64 --publish never
```

Intel Mac：

```bash
npm run build
npx electron-builder --mac dmg --x64 --publish never
```

完成后在 `dist/` 中生成 `.dmg` 文件。

#### Windows：生成安装程序

请在 Windows x64 本机的 PowerShell 中打包：

```powershell
npm run build
npx electron-builder --win nsis --x64 --publish never
```

完成后在 `dist/` 中生成 `*Setup*.exe` 安装程序。

---

## 功能详解

### Append：试听与入库

将待整理音频放入 `Append/`，点击刷新读取文件。扫描支持 MP3、FLAC、WAV、OGG、M4A、AAC、APE 扩展名。

- 双击歌曲可直接试听，无需先入库。

- 点击歌曲右侧加号进入“添加到音乐库”，可编辑曲名、文件名、艺术家、专辑、Tag、歌词、评分和评论。

- 点击顶栏确认后，音频从 Append 移动到 Music，同时写入数据库。

- 已导入的外部 LRC 歌词内容保存在数据库，成功入库后会尝试删除所选歌词源文件；清空按钮会清除歌词内容和文件关联。

- 顶栏删除按钮会删除对应的 Append 音频。

- 编辑界面中单击艺术家、专辑或已选 Tag 可跳转对应主页，从详情页返回时保留本次未提交的入库草稿。

### Music 与歌曲编辑

Music 页面展示全部已入库歌曲，支持按音乐库顺序、首字母、添加时间排序，并切换升降序。搜索匹配曲名、艺术家、专辑和厂牌（支持日语罗马字、平假名、片假名匹配，例如 `memoria` 可匹配 `メモリア`）。

- 双击歌曲会以当前列表建立播放队列，双击正在播放的同一首会从头开始。
- 单击随机播放按钮将从当前页面歌曲中开始随机播放。
- “歌曲信息”默认只读，点击编辑可修改资料。
- 重载区域可改文件名或选择替换音频，随保存信息一起提交。

- 删除歌曲会删除原始音频、数据库记录和对应图片。关联对象（如专辑、艺术家）失去音乐引用时会执行自动清理。

### Artist、Album 与 Tags

#### 艺术家与厂牌

艺术家分为“Person”“Group”“Label”三种类型，均会在 Artist 页面显示。艺术家主页可编辑名字、类型、国家、头像等信息。厂牌使用 `Label` 类型，在专辑信息中仅可作为厂牌使用。

#### 专辑

Album 页面可搜索专辑、专辑艺术家和厂牌，也支持排序。专辑详情的曲目固定按碟号、音轨号排列，左侧显示音轨号。同一张专辑可关联多个艺术家和多个厂牌。主页可编辑日期、类型、总碟数及上传封面。在入库或歌曲编辑的专辑表单中选择 Single / EP 时，会将碟号与总碟数设为 1。

#### Tags

一首歌可拥有多个 Tag，提供 Genre、Mood、Playlist、Scene、Chart、Theme、Work、Memory、Best、Month、Year 类型。Tag 在主页中可改名、调整类型或删除。

普通 Tag 按名称排列；Year 的 `YYYY`、Month 的 `YYYY.M` / `YYYY.MM` 按实际时间升序排列。具体 Tag 的歌曲按数据库 `sort_order` 展示，可拖拽改变顺序。每首歌在不同 Tag 下可有独立评论，存于 `song_tags.comment`，与歌曲自身评论不同。

### 团队 / 厂牌成员

Group / Label 主页显示已保存的成员列表，点击成员名进入对应艺术家主页，返回键回到原团队主页。编辑页中点击已选成员的名字也可跳转。

### 艺术家别名

艺术家编辑页提供“设为别名”的操作。

- 主艺名与别名仍是独立艺术家记录，通过关联表连接。

- 歌曲保留实际署名，点击别名进入该名义的主页，在名称下显示“a.k.a. 主艺名”。

- 主艺名主页同时汇总其别名名义下的歌曲。

- 别名不是“合并艺术家”：合并会转移关联并删除原艺术家，删除艺术家也会解除其关系并移除头像。

### 播放、歌词与可视化

- 点击底部封面展开全屏播放器，点击左上角向下箭头或按 ESC 收起。

- 底部与全屏共用播放控制、进度条和队列。

- 全屏中的艺术家、专辑，以及可视化上方的 Genre / Mood 均可跳转详情页。

- 带时间戳歌词：LRC 当前句高亮并自动居中。双击任意带时间戳的歌词行可跳转。
- 纯文本歌词：可浏览，不能逐句同步或跳转。
- 无歌词可视化：显示实时频谱、可点击跳转的波形、GENRE / MOOD 和三个底部指标。

### 加权随机

随机模式使用下述权重生成每轮顺序——

每轮按权重无放回打乱：每个队列条目播放一次，再生成下一轮。距离上次播放 `d` 个本地日历日时，权重为 `1 + 3 × d / (d + 14)`；当天为 1，14 天为 2.5，从未播放为 4。

### 聆听记录

`last_heard_date` 在本次实际累计聆听达到歌曲总时长的 60% 时记录一次。重复听同一段也累计，暂停、缓冲、加载和拖动进度的跳跃不计入。

---

## 其他工具

### 网易云音乐导入

先在 **Settings → 存储位置** 选择网易云音乐下载目录，并将适配当前平台的解码工具放入 `.system/tools/`，保证它可执行。点击 Append 右上角“解码网易云音乐”按钮后：

1. 解码下载目录根层的 NCM，将结果移动到 Append；只有导入成功后才删除对应 NCM 源文件。
2. 将根层 MP3、FLAC 和 LRC 移动到 Append。
3. 音频导入失败时保留其源文件和同名歌词，并继续处理其他文件。
4. 弹窗展示本次新增音频，以及缺失封面或失败提示。

### Tag 歌单导出

在 **Tools → Playlist → 生成 Playlist** 中手动导出全部 Tag，生成位置固定为 `<音乐根目录>/Music/Playlist/<Tag 类型>/<Tag 名称>.m3u`。歌曲顺序与 Tag 页面一致（`sort_order`，相同顺序值按歌曲 ID 排列）。

完成后展示类型数、歌单数、独立歌曲数、歌曲条目数和跳过清单，并可打开输出文件夹。

### 音频标签写入

**该操作会修改原音频文件。** 

在 **Tools → 音频标签 → 一键写入** 中将全库歌曲的数据库信息写入对应原音频。实时显示当前歌曲、处理阶段、进度及写入 / 跳过 / 失败数量。离开页面后任务继续运行，返回时恢复当前进度。点击“停止写入”会完成当前歌曲后停止。

数据库中保存音频文件上次写入的 Hash，当上次成功、导出信息 SHA-256、文件完整 SHA-256 和写入器版本均相同时跳过写入。

写入时会覆盖数据库有值的字段，保留未指定字段。艺术家、专辑艺术家、厂牌与 Genre / Mood / Work / Theme 多值用 `/` 拼接。字段详细映射见 [标签映射说明](docs/audio-tag-writeback-handoff.md)。

### 音乐库检查

**Inspect** 提供以下检查

| 检查项         | 行为                            |
| ----------- | ----------------------------- |
| 音频文件关联      | 列出数据库存在但原音频缺失的歌曲              |
| 封面缩略图       | 尝试从关联音频重建缺失缓存，只列出仍不可恢复项       |
| 未关联图片       | 检查 assets 中未对应数据库歌曲、专辑或艺术家的图片 |
| 无歌曲专辑       | 列出空专辑，结果弹窗可手动清理               |
| 无歌曲艺术家 / 厂牌 | 按关联关系检查，结果弹窗可手动清理             |
| 重名艺术家 / 厂牌  | 列出同名记录及其类型、ID，供人工核对           |

## 软件架构

见 [架构说明文档](docs/architecture.md)
