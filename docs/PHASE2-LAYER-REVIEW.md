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

## PSD 权威来源（已验证）

| 来源 | 本机 `sample` 结果 | 结论 |
|------|-------------------|------|
| See-through 彩色 PSD | 仅 **3** 层（有像素的 face / back hair / eyelash），且为裁剪 bbox | **不能**作为完整导出权威 |
| `decomposition/layers/*.png` + `layer-manifest.json` | **24** 个全画布 RGBA part | **导出权威** |
| 重建 PSD（`export_psd.py`） | 24 层、顺序/名称/透明度可回读；CJK 名需 `encoding=utf-8` | 通过 `psd_tools` 自检 |

说明：合成测试图多数 part 为空；真实立绘会有更多非空层。Cubism 人工打开验收仍待本机执行。

## 当前已实现

1. 产物规范化：`adapter/normalize_layers.py` + `ingest_phase0.py`
2. 图层清单：`getJobLayerReview`（`petjob://`）
3. 审阅 UI：合成 / 显隐 / 单层 / 叠原图 / 缩放
4. **非破坏修订**：`revision_ops.py` → `revisions/revision-NNN/`（不写 `decomposition/`）
5. **轻量修正**：重命名、排序、显隐、透明度 → 保存新修订
6. **PSD 导出**：`export_psd.py` 按指定 `revision_id` 重建 + 回读校验 + `*.export.json`
7. 状态出口：`awaiting_rigging`；导出后仍 `live2d_ready=false`
8. 演示入口：高级选项「导入 phase0 演示产物」

## 下一步

1. 局部遮罩修正（补回 / 擦除）
2. Cubism Editor 打开导出 PSD 并记录绑定步骤
3. ≥3 张真实立绘端到端验收
