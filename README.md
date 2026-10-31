# DesktopPet 桌宠

可安装的 Live2D 桌面宠物（内置 Haru 示例）。

参考：[PPet](https://github.com/zenghongtu/PPet)、[BongoCat](https://github.com/ayangweb/BongoCat)、[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)

## 功能

- Live2D 全身显示、动作 / 表情切换  
- 可隐藏气泡、齿轮等界面控件（右键 / 托盘仍可开设置）  
- 音色库：多样本 WAV 上传 → 评分拼接约 10s `prompt.wav` → CosyVoice 克隆试听  
- Windows 安装包（可选路径、可选桌面快捷方式、可卸载）+ 便携版  
- 双击 `启动桌宠.bat` 本机直接打开  
- 托盘、单实例、记住位置、开机启动  

## 目录结构

```text
build/          应用图标
electron/       主进程 / 预加载 / 托盘 / 音色库 / 角色库
public/         Live2D 角色与 Cubism Core
src/            前端
scripts/        启动 / 清理 / 假流水线 / 测试样本
testdata/       本机测试用 WAV 等人声样本（见目录内说明）
启动桌宠.bat
```

`dist/`、`out/` 为构建产物，已加入 `.gitignore`。

## 本机直接打开（不用安装包）

前提：已安装 [Node.js LTS](https://nodejs.org/)。

双击项目根目录的 **`启动桌宠.bat`** 即可（不要关弹出的黑窗口）。  
首次可能先构建几十秒，成功后右下角会出现桌宠。

也可以在终端：

```powershell
npm install
npm run open
```

开发热更新用：`npm run dev`。

## 打包安装版

```powershell
npm run dist:win
```

产物在 `out/`：

| 文件 | 说明 |
|------|------|
| `DesktopPet-Setup-*.exe` | 安装包：可选目录；可取消「桌面快捷方式」；可卸载 |
| `DesktopPet-Portable-*.exe` | 便携版：不写入卸载列表 |

默认安装路径：`%LOCALAPPDATA%\Programs\DesktopPet\`  
卸载：设置 → 应用 → 已安装的应用 → `DesktopPet`

`npm run clean` 可清理构建产物。若旧 `release/` 删不掉，重启 Cursor 后再清理。

## 使用

1. 双击 `启动桌宠.bat`，或运行 Setup / Portable  
2. 顶部拖动；右键 / ⚙ / 托盘打开设置  
3. 托盘双击显示或隐藏  

内置：`haru`（模型已下载到 `public/characters/haru/`，可断网使用）。

## 产品定位与阶段路线

**AI 辅助角色制作工作站 + Live2D 桌宠运行时**（不承诺一键生成完整 `.moc3`）。

| 文档 | 内容 |
|------|------|
| [`docs/ROADMAP-AI-ASSISTED.md`](docs/ROADMAP-AI-ASSISTED.md) | 架构、模块落点、阶段 0–3 |
| [`docs/PHASE0-COMPAT.md`](docs/PHASE0-COMPAT.md) | 本机显存/依赖兼容与 See-through 验收表 |
| [`docs/PHASE2-LAYER-REVIEW.md`](docs/PHASE2-LAYER-REVIEW.md) | 图层审阅 / 修订 / PSD 导出约定与验收 |
| [`docs/JOB-ARTIFACTS.md`](docs/JOB-ARTIFACTS.md) | 任务产物目录规范 |
| [`services/image-pipeline/`](services/image-pipeline/) | **独立** Python 分层环境（See-through），与 Node 隔离 |

| 阶段 | 目标 | 状态 |
|------|------|------|
| **运行时 A** | 任务 → 占位/导入 → 桌宠显示 | ✅ 可用（preview-placeholder + moc 导入） |
| **阶段 0** | See-through 环境 + 分层 PSD + Haru 回归 | ✅ 本机 NF4 已通（≈5.3GB / ~10min；合成图） |
| **阶段 1** | 任务 spawn 适配器 → `needs_review` | ✅ |
| **阶段 2** | 审阅 / 非破坏修订 / PSD 重建导出 | 🚧 代码+P0 自测已通；**Cubism 真机与 ≥3 张真实立绘待验收** |
| **阶段 3** | 人工绑定真实模型导入播放 | 待做 |
| **恋活三维 C** | KKBP 等可行性实验（独立于 Live2D） | 待验证 |

分层成功 / 修订成功 / PSD 导出成功都**不会**把 `live2d_ready` 设为 true。

素材生成器与桌宠运行时分离：分层失败不影响窗口；mock 成功 ≠ 真实 Live2D 生成。

### 阶段 A 验收（本机）

1. `npm run open` 启动桌宠  
2. 设置 → **角色生成** → **恋活卡 → 建任务**（或立绘）  
3. 任务行点 **生成本地占位** → 桌宠切换为该预览图（角标「预览占位」，**不是** Live2D）  
4. 关闭再打开，角色仍在  

可选：高级选项填流水线地址后测 mock（见下）。

## 角色生成（导入 + 流水线骨架）

设置分三栏：**常用** / **角色生成** / **音色**（Esc 关闭）。

**角色生成**操作：

1. **立绘 → 建任务** / **恋活卡 → 建任务**（剥预览图与姓名；恋活默认目录 `UserData/chara/female`）  
2. **生成本地占位**：把任务预览图打成 sprite 角色包并显示（阶段 A 主路径）  
3. 若已填流水线地址，建任务时可自动 `POST /generate`；也可事后「调用流水线」或「关联 moc」  
4. **导入 moc**：直接选 `.model3.json`  
5. HTTP 约定：`POST {url}/generate`，字段 `image`，响应含 `.model3.json` 的 **zip**  

### 测试适配器（假流水线，仅链路）

```powershell
npm run pipeline:mock
```

- 地址默认 `http://127.0.0.1:51000`  
- **一律返回内置 Haru zip**，与上传图无关；响应头带 `X-Pet-Adapter: mock-haru`  
- 勿当成真实角色生成  

### 真实分层（阶段 0，独立 Python）

```powershell
npm run pipeline:image:setup
# 按 services/image-pipeline/README.md 在 conda 中安装 See-through（8GB 用量化脚本）
# 将有权使用的立绘放到 services/image-pipeline/fixtures/sample.png 后：
powershell -ExecutionPolicy Bypass -File services/image-pipeline/scripts/run-phase0-decompose.ps1 -Image services/image-pipeline/fixtures/sample.png
```

自定义角色通过 `petchar://` 从 Electron `userData/characters/` 加载。

## 音色克隆（CosyVoice）

1. 本机启动 CosyVoice WebUI / API（默认 `http://127.0.0.1:50000`）  
2. 设置 → **音色库** → 上传多段清晰人声 **WAV**（越多越好）  
3. 应用会按质量评分选出片段，拼成约 10 秒的 `prompt.wav`  
4. 填写服务地址后点 **用克隆音色试听**（调用 `inference_cross_lingual`）  

样本存在 Electron `userData/voices/<角色id>/`。当前是 **零样本克隆用 prompt**，真正微调训练后续再做。

## 添加 Live2D 角色

在 `src/characters.js` 的 `CHARACTER_IDS` 登记，并放入 `public/characters/<id>/`：

```json
{
  "id": "my-l2d",
  "type": "live2d",
  "model": "./MyModel.model3.json",
  "fit": 0.92,
  "defaultExpression": "idle",
  "expressions": [
    { "id": "idle", "names": { "zh-CN": "待机", "en": "Idle", "ja": "待機" }, "motion": "Idle", "motionIndex": 0 }
  ],
  "lines": { "idle": { "zh-CN": "嗨。", "en": "Hi.", "ja": "やあ。" } }
}
```

Cubism Core：`public/lib/live2dcubismcore.min.js`。  
模型版权归原作者；Haru 来自 [CubismWebSamples](https://github.com/Live2D/CubismWebSamples)。
