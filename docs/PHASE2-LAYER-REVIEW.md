# 阶段 2：图层审阅 / 修正 / 修订 / PSD 出口

## 产品边界（再次锁定）

- 分层成功 ≠ Live2D 就绪；禁止 `live2d_ready=true`、禁止伪造 `.moc3`。
- mock Haru 不得当作用户立绘结果。
- 本阶段不改 `Live2DStage`，不做自动绑定 / 动作 / 物理。

## See-through 实际产物（本机 `phase0/first-run`）

| 产物 | 说明 | 审阅复用 |
|------|------|----------|
| `<stem>/` 目录 | 每部件一张 RGBA PNG（1024²）+ `*_depth.png` | **主数据源** |
| `info.json` | `parts` 键 = 语义标签全集 | 图层命名 |
| `<stem>.psd` | `psd_tools` 写出的彩色 PSD | 打开 / 导出基线 |
| `<stem>_depth.psd` | 深度 PSD | 次要；默认不进编辑列表 |
| `<stem>.psd.json` | 部分部件 `xyxy` / `part_id` | bbox（可选） |
| `reconstruction.png` / `src_*.png` | 重建与原图裁切 | 只读参考，默认隐藏 |

部件标签与上游 `VALID_BODY_PARTS_V3` 一致。合成绘制顺序见适配器 `BACK_TO_FRONT`。

**注意：** 直接跑 `inference_psd_quantized.py` 时不会自动写 `layer-manifest.json`；需经 `decompose_cli` / `ingest_phase0.py` 规范化进任务目录。

## 任务目录约定（阶段 2）

```text
live2d-jobs/<id>/
├── source/original.png
├── decomposition/          # AI 原始（只读约定）
│   ├── layers/*.png
│   ├── depth/
│   ├── refs/
│   ├── layer-manifest.json
│   └── ORIGINAL.txt
├── revisions/              # 人工修订（下一步实现写入）
│   └── revision-001/
├── exports/*.psd
└── job.json                # needs_review → awaiting_rigging
```

前端**只**通过 IPC + `petjob://<jobId>/<rel>` 取图，不拼本地绝对路径。

## 当前已实现

1. 产物规范化：`adapter/normalize_layers.py` + `ingest_phase0.py`
2. 图层清单：`getJobLayerReview`（`electron/layer-review.cjs`）
3. 只读审阅 UI：`LayerReviewPanel.jsx`（合成、显隐、单层、叠原图、缩放）
4. 状态出口：`markAwaitingRigging`（仍 `live2d_ready=false`）
5. 演示入口：高级选项「导入 phase0 演示产物」

## 下一步（仍属阶段 2）

1. 非破坏修订：重命名 / 排序 / 透明度 / 局部遮罩 → `revisions/revision-NNN`
2. 从修订导出 PSD（`psd_tools`，须 Cubism 可打开验证）
3. 验收：≥3 张不同类型立绘跑通「分层 → 修正 → 导出 → Cubism 打开」
