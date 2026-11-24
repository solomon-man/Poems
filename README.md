# Poems

## 下载 Windows 版

**[⬇ 下载 Windows x64 安装包（Poems 0.5.0）](https://github.com/solomon-man/Poems/releases/download/v0.5.0/Poems-0.5.0-win-x64.exe)** · [全部发行版](https://github.com/solomon-man/Poems/releases)

双击安装程序，选择安装目录，完成后从桌面打开 Poems。

Poems 基于 AlgerMusicPlayer、Electron 和 Vue 3，支持本地音乐播放、歌谱检索、歌词识别和本地 AI。首次使用可先在本地音乐页选择歌曲文件夹。

## 0.5.0 使用指南

- **只记得一句歌词**：打开「诗歌本」，直接输入歌词。搜索同时匹配歌名、编号和歌词，结果显示匹配的原句。点击文件打开 PDF，点击「编排」可从匹配行试听已关联的音频。内置 1914 份歌谱中，1912 份含可提取行。扫描件请先执行「识别歌词 → PDF」，保存的识别和校对结果优先参与搜索。
- **修复桌面入口**：重新运行 Windows 安装程序即可重建 Poems 快捷方式，指向本次安装目录。建议使用本机默认目录。
- **听写与打点**：「编排」支持逐行试听、循环、编辑、按光标拆行和合并下一行。在音频播放时将焦点移出文本框，按空格为当前行打点并移至下一行。改完点击「保存校对」。
- **聚会投影**：从「编排」把歌曲加入命名歌单，支持调整顺序。点击歌单条目，再点「投影当前行」。有外接屏时歌词优先显示在另一屏；控制窗口使用左右键翻行、上下键切歌，或点击按钮。投影窗口按 Esc 退出。
- **换机与备份**：「聚会歌单与备份 → 备份歌库」可导出自建歌本、PDF、识别和校对结果、聚会歌单与收藏。恢复前会要求确认替换。音频文件另行复制，随后选择「重新关联音乐目录」；系统只重连文件名唯一且原路径失效的 MP3。

## 已实现功能

### 音乐资料

- 扫描本地 MP3、FLAC、WAV、OGG、M4A、AAC
- 增量更新本地音乐库，读取标题、艺术家、专辑、封面和内嵌歌词
- 播放历史真实持久化，记录播放次数和最近播放时间
- 本地歌曲收藏、取消收藏及重启恢复
- 内置 1914 份诗歌 PDF，支持分类、编号和关键词检索

### 播放体验

- 点击左下角封面进入沉浸式歌词
- 独立桌面歌词窗口
- 明暗主题切换
- 迷你播放器模式
- 播放速度 `0.25x - 2.0x`
- 10 段 EQ 均衡器及多种预设
- 定时开始播放
- 按时间、歌曲数或播放列表结束定时关闭

### 桌面控制

- Windows/macOS/Linux 系统托盘控制
- 上一首、播放/暂停、下一首、收藏、显示窗口和退出
- 自定义快捷键，可分别配置为全局或仅应用内生效
- 局域网远程控制页面及 HTTP API
- 播放状态、当前歌曲、托盘和远程控制保持同步

## 识别歌词

进入「诗歌本」，点击顶部的「从文件识别歌词」选择本地文件，也可以点击某首诗歌右侧的「识别歌词」。在结果窗口可以复制歌词、保存 TXT，有时间轴时还可导出 LRC。对诗歌本条目识别成功后，下次从诗歌本播放会自动使用保存的歌词。

- **音频**使用本地模型识别普通话人声并按唱词生成时间戳。Windows x64 首次使用需要联网下载 Python、识别引擎和模型。准备完成后可以离线识别，音频保留在本机。和声、强伴奏和拖长音会影响准确度。[faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- **PDF**先读取文字层，扫描页使用随软件提供的简体中文、繁体中文和英文 OCR 模型。独立 PDF 可导出纯文本。诗歌已匹配音频时，播放器可按歌曲时长估算时间轴。请对照原谱核对识别结果。[PDF.js](https://github.com/mozilla/pdf.js) · [Tesseract.js](https://github.com/naptha/tesseract.js) · [OCR 字库](https://github.com/naptha/tessdata)

已有离线环境时，可用 `LOVE_HYMN_WHISPER_PYTHON` 指定已装好 faster-whisper 的 Python 解释器，用 `LOVE_HYMN_WHISPER_MODEL` 指定本地 CTranslate2 模型目录。

## 本地 AI（Windows x64）

在「诗歌本」顶部打开「本地 AI」，输入问题或粘贴歌词。可以连续追问、取消回答或清空本次对话。要校对歌词，打开一首诗歌的识别结果，选择模型，点击「AI 校对」。界面会逐行列出原文和建议；勾选并采用后，再次播放和导出的歌词会使用新文本，已有时间戳会保留。独立文件的修改可以从结果窗口导出。

- 默认选用 Qwen2.5-1.5B-Instruct，也可切换为 DeepSeek-R1-Distill-Qwen-1.5B。两者均为 4 位 Q4_K_M 量化，每个模型约 1.12 GB。Windows 安装包内含 CPU 推理引擎。首次使用所选模型时下载权重并核验 SHA-256，之后可以离线使用。推理在本机 CPU 上运行。[Qwen 量化模型](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF) · [DeepSeek 原始模型](https://github.com/deepseek-ai/DeepSeek-R1) · [DeepSeek 量化权重](https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF) · [llama.cpp](https://github.com/ggml-org/llama.cpp)
- 已下载的模型和引擎缓存在当前用户目录的 `.cache/love-hymn/local-ai/v1` 下。音频识别仍使用 Whisper，扫描歌谱仍使用 OCR。AI 校对处理识别后的中文文本，遇到同音字和专有名词时请对照原谱选用建议。

## 项目结构

```text
src/main/              Electron 主进程、窗口、托盘、快捷键和远程控制
src/preload/           安全的 IPC 桥接
src/renderer/          Vue 页面、播放器、歌词、收藏、历史和设置
src/shared/            主进程与渲染进程共享类型及工具
resources/html/        远程控制网页
test-fixtures/         Electron 自动化测试音频
scripts/               构建和端到端验收脚本
```

诗歌 PDF 的开发期来源：

```text
songbooks
```

打包时会复制到应用资源目录中的 `hymns` 文件夹。

## 开发

环境建议：Node.js 22.12 或更高版本。

```powershell
git clone https://github.com/solomon-man/Poems.git
cd Poems
npm ci
npm run dev
```

## 验证

```powershell
npm run typecheck
npm run build
npm run verify:e2e
npm run verify:lyrics
```

要验证真实模型，可在构建后运行 `npm run verify:ai -- qwen deepseek`。此命令逐个测试所选模型的本地问答、歌词校对和取消操作，复用播放器的模型缓存。

`verify:e2e` 会启动真实 Electron 生产构建，自动验证本地扫描和播放、历史、收藏、快捷键、主题、EQ、倍速、定时播放、沉浸式歌词、桌面歌词、远程控制、托盘、持久化和迷你模式，并把截图写入 `test-artifacts`。

## Windows 打包

```powershell
npm run build:win
```

主要输出：

```text
dist/Poems-0.5.0-win-x64.exe
dist/win-unpacked/Poems.exe
```

安装程序允许选择安装目录，并创建桌面和开始菜单快捷方式。

## 远程控制

在“设置 -> 应用设置 -> 远程控制”中启用服务并设置端口。浏览器访问设置页显示的局域网地址即可控制播放。

常用接口：

```text
GET  /api/status
POST /api/toggle-play
POST /api/prev
POST /api/next
POST /api/volume-up
POST /api/volume-down
POST /api/toggle-favorite
```

## 说明

- `LOVE_HYMN_TEST_MUSIC_DIR` 只用于自动化测试时跳过系统文件夹选择框，正常运行不受影响。
- 仓库中的 `songbooks/` 包含随安装包发行的 PDF 歌谱。
- 当前应用 ID：`pri.prepare.lovehymn.desktop`。
