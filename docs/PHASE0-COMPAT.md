# 阶段 0：环境与兼容性验证报告

生成日期：2026-10-29（本机探测）。  
产品定位：**AI 辅助角色制作工作站 + Live2D 桌宠运行时**，不承诺一键生成完整 `.moc3`。

## 1. 本机硬件 / 运行时

| 项 | 本机结果 | 对 See-through 的影响 |
|----|----------|------------------------|
| GPU | NVIDIA GeForce RTX 5060 Laptop，**8151 MiB**（约 8 GB） | 不能走默认 bf16@1280（需 12–16 GB）；**必须**用官方 `inference_psd_quantized.py`（NF4）或 `blockswap`，必要时 `--resolution 1024` |
| Driver | 617.14 | 需与所选 CUDA / PyTorch wheel 匹配；官方示例为 CUDA 12.8 |
| Python | 3.12.10 | 与 See-through 要求一致 |
| Node | v24.19.0 / npm 11.17.0 | 仅桌宠与 Job Orchestrator；**禁止**把 PyTorch 装进 Node 环境 |

## 2. 桌宠渲染栈（锁定，阶段 0 不升级）

| 依赖 | 版本 | 说明 |
|------|------|------|
| `electron` | ^34.2.0 | 桌面壳 |
| `pixi.js` | ^6.5.10 | 渲染 |
| `pixi-live2d-display` | **0.4.0** | 经 `cubism4` 入口加载 |
| Cubism Core | `public/lib/live2dcubismcore.min.js` | 与现有 Haru（model3 / moc3）配套 |
| 内置模型 | `public/characters/haru/` | 含 `Haru.moc3`、`physics3`、`motions/`、`expressions/` |

**回归要求：** 任意图像流水线改动后，Haru 仍能在 `Live2DStage` 中加载、播 Idle、物理摆动正常。  
**阶段 0 不升级** Pixi / pixi-live2d-display / Cubism Core，避免与「新生成模型」问题缠在一起。

## 3. 现有任务流水线（仓库现状）

| 能力 | 路径 | 状态 |
|------|------|------|
| 建任务（立绘 / 恋活预览） | `electron/character-bank.cjs` → `createJobFromImage` / `createJobFromKkCard` | 已有 |
| 本地占位（非 Live2D） | `createPlaceholderFromJob` | 已有（阶段 A） |
| HTTP `POST …/generate` | `runJobPipeline` | 已有；**mock 返回 Haru，不是真实分层** |
| 导入真实模型包 | `importCharacterPack` / `attachPackToJob` | 已有 |
| 播放 | `src/components/Live2DStage.jsx` | 已有 |

当前 mock 成功 ≠ Live2D 生成成功。阶段 1 起任务状态需区分 `decomposing` / `needs_review` / `awaiting_rigging` / `succeeded`。

## 4. See-through 边界（必须写进产品话术）

上游项目：[shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)

- **做：** 单张二次元立绘 → 语义分层 + 遮挡补全 → 可编辑 **PSD**（约最多 23 层）。
- **不做：** 网格、变形器、参数、`.moc3`、高质量动作/物理自动生成。
- 官方亦说明：这不是完整 Image-to-Live2D。
- 许可证：仓库 Apache-2.0 **不自动覆盖**所有权重与第三方依赖；商用前需单独核查。

## 5. 阶段 0 通过标准（检查表）

仓库内已完成（骨架）：

- [x] 兼容探测写入本文件 + `workspace/compat-snapshot.txt`（GPU ≈8GB → 强制量化路径）
- [x] `services/image-pipeline/` 独立目录；dry-run 可生成 `source/` + `decomposition/layer-manifest.json`
- [x] 适配器明确 `live2d_ready: false`，不伪造 `.moc3`
- [x] See-through 源码已落到 `vendor/see-through`（直连 `git clone` 仍易失败；已用 `codeload` zip 拉取）
- [x] venv 安装 PyTorch cu128 + 推理依赖 + bitsandbytes（本机无 conda）
- [x] NF4 量化分层跑通并写出 PSD（合成测试图；真实立绘质量仍待评）
- [ ] 用 Photoshop / Photopea / Cubism 打开 `sample.psd` 目视检查
- [x] 记录耗时 / 峰值显存（见下表）
- [ ] `npm run open`：目视确认 Haru 动作与物理
- [x] 产物目录：`services/image-pipeline/workspace/phase0/first-run/`

## 6. 实测记录

| 字段 | 值 |
|------|-----|
| 日期 | 2026-10-29 |
| 输入图 | `fixtures/sample.png`（合成 RGBA 测试图，非真实立绘）768×1024 |
| 环境 | `services/image-pipeline/.venv`（无 conda；Python 3.12 + torch 2.8.0+cu128） |
| 脚本 | `inference_psd_quantized.py` |
| 模型 | 本地 `workspace/models/seethroughv0.0.2_layerdiff3d_nf4` + `…marigold_nf4`（hf-mirror curl 拉取） |
| 额外参数 | `--resolution 1024 --no_group_offload`；`bitsandbytes 0.50.2` |
| 耗时 | 约 **631 s**（LayerDiff ~594 s，Marigold ~25 s，PSD ~1 s） |
| 峰值显存 | **~5.34 GB**（8 GB 卡可接受） |
| PSD 路径 | `workspace/phase0/first-run/sample.psd` |
| 图层数 / 明显问题 | 合成图仅验证链路；默认 group_offload 在本机触发 CUBLAS/设备错误，需 `--no_group_offload` |
| Haru 回归 | 资源未改动（`Haru.moc3` / `Live2DStage` 仍在）；请本机 `npm run open` 目视确认 |
| 结论 | **可继续阶段 1 集成**；正式验收需换成真实二次元立绘再评图层质量 |

## 7. 结论门槛（决定阶段 1 是否开工）

| 结果 | 下一步 |
|------|--------|
| 量化路径稳定出可用 PSD | 进入阶段 1：Job 适配器 + 产物落盘 |
| OOM 或极慢但降到 1024 可用 | 阶段 1 默认量化 + 低分辨率，并在 UI 标明 |
| 无法安装或质量不可用 | 暂停集成，评估 ComfyUI-See-through 或其他分层方案，**不**并行塞多个推理栈 |
