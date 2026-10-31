# 研发路线：AI 辅助制作工作站 + Live2D 运行时

## 产品边界

- **是：** AI 分层 / 遮挡补全 → 人工修正 → PSD → Cubism Editor 绑定 → 导入现有桌宠播放。
- **不是：** 一键生成完整、可商用质量的 Live2D（含自动 `.moc3` / 物理 / 全套动作）。
- `.moc3` 为 Cubism Editor 导出的模型数据，不是图层或 JSON  alone 可替代的。

## 模块 ↔ 本仓库落点

| 模块 | 职责 | 本仓库位置 | 阶段 |
|------|------|------------|------|
| Desktop Runtime | 透明窗、播放、交互 | `electron/*`, `src/components/Live2DStage.jsx`, `PetStage.jsx` | 复用 / 微调 |
| Job Orchestrator | 任务、文件、重试、日志 | `electron/character-bank.cjs`（扩展）；日后可拆 `services/orchestrator` | 1 |
| Image Pipeline | See-through 分层 | `services/image-pipeline/`（**独立 Python**） | 0–1 |
| Rigging Workflow | 人工绑定出口 / 日后自动化 | 文档 + Cubism；`validate-model` 在 character-bank | 2–3 |
| 恋活二维 | 预览图 → 同上二维流水线 | `electron/kk-card.cjs` 已有提取 | 复用 |
| 恋活三维 | KKBP 等可行性实验 | `docs/` 实验记录，**不进主路径** | 并行验证 |

## 技术路线

```text
PNG/JPG/WEBP / 恋活卡
        │
        ├─ 二维：预处理 → See-through → 人工修正 → PSD
        │         → Cubism Editor → 模型包 → Live2DStage
        │
        └─ 恋活三维（独立实验）：游戏内导出 → Blender/FBX → 最小 3D 运行时
```

## 阶段交付

| 阶段 | 交付物 | 文档 / 代码 |
|------|--------|-------------|
| **0** | 兼容报告 + 一张真实分层 PSD + Haru 回归 | ✅ 合成图 NF4 已通（~5.3GB / ~10min）；见 `PHASE0-COMPAT` §6 |
| **1** | 真实任务：`queued→decomposing→needs_review` | ✅ Electron「AI 分层」spawn 适配器 |
| **2** | 图层面板 + 修正版本 + PSD 导出 | 🚧 修订/导出/P0 自测已通；遮罩 + Cubism + 真实立绘待做（`PHASE2-LAYER-REVIEW.md`） |
| **3** | ≥1 个由目标立绘人工绑定的可播放模型 | 导入验收 + 状态三分（分层完成 / 待绑定 / 可播放） |

## 建议提交顺序（阶段 0–1）

1. `chore: add isolated image pipeline environment` ← **本批**
2. `feat: add image decomposition job adapter`
3. `feat: persist pipeline artifacts and revisions`
4. `feat: add layer review and correction workflow`
5. `feat: export layered PSD`
6. `feat: validate imported Live2D model packages`
7. `test: add end-to-end character generation fixtures`

## 目标任务目录（阶段 1+；仅写入真实产物）

见 `docs/JOB-ARTIFACTS.md`。未绑定时**禁止**伪造空的 `.moc3` / `model3.json` 冒充成功。

## API 演进（阶段 1+，建议）

保留现有 `POST /generate` 作兼容，逐步迁到：

- `POST /api/v1/jobs`
- `GET /api/v1/jobs/{id}`
- `POST …/cancel` | `retry` | `revisions` | `export-psd` | `validate-model`

状态机：`queued` → `preprocessing` → `decomposing` → `needs_review` → `exporting` → `awaiting_rigging` → `validating` → `succeeded` | `failed` | `cancelled`。

当前 Electron 侧状态仍为 `queued|running|done|failed`；阶段 1 映射时勿把 mock Haru 标为真实 `succeeded` 分层。
