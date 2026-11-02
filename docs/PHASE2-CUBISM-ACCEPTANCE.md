# Phase 2：Cubism Editor 人工验收记录

> **状态：** 本机已准备验收 PSD；**尚未**在 Cubism Editor 中执行人工验收。  
> 无真实 Cubism 操作证据的项一律为 `NOT TESTED`。  
> `psd_tools` 回读成功 ≠ Cubism Editor 验收通过。  
> 禁止在此文档填写虚构的 PASS/FAIL。

## 环境（人工填写）

| 项 | 值 | 状态 |
|----|-----|------|
| Cubism Editor 版本 | （填写，例如 Cubism Editor 5.x） | NOT TESTED |
| Windows 版本 | （填写，例如 Windows 10/11 build） | NOT TESTED |
| 验收人 | | NOT TESTED |
| 验收日期 | | NOT TESTED |

## 测试产物来源

> `phase2-ingest-test` 是 **PSD 导出器回归样本**（合成测试图，仅 4 个非空层），用于验证导出结构与 Cubism 格式兼容性，**不能**作为 AI 分层质量的验收依据。真实立绘验收见 [`PHASE2-REAL-IMAGE-TEST.md`](./PHASE2-REAL-IMAGE-TEST.md)。

| 项 | 值 |
|----|-----|
| Job | `services/image-pipeline/workspace/jobs/phase2-ingest-test` |
| Revision | `original` |
| 画布（export.json） | 1024 × 1024 |
| 验收目录（本机，不入 git） | `services/image-pipeline/workspace/phase2-cubism-acceptance/` |
| Job 内同名导出 | `…/phase2-ingest-test/exports/cubism-A-keep-empty.psd` / `cubism-B-skip-empty.psd` |

`workspace/` 已在 `.gitignore` 中；PSD 体积大，**不提交仓库**。验收前在本机按下方命令重新导出，并用 SHA256 与下表核对。

### 重新导出（PowerShell）

```powershell
cd F:\restore\github-local-repository\furiberto-first-repository
$py = ".\services\image-pipeline\.venv\Scripts\python.exe"
$job = ".\services\image-pipeline\workspace\jobs\phase2-ingest-test"
$out = ".\services\image-pipeline\workspace\phase2-cubism-acceptance"
New-Item -ItemType Directory -Force -Path $out | Out-Null

& $py .\services\image-pipeline\adapter\export_psd.py --job $job --revision original --out-name cubism-A-keep-empty.psd
& $py .\services\image-pipeline\adapter\export_psd.py --job $job --revision original --out-name cubism-B-skip-empty.psd --skip-empty

Copy-Item "$job\exports\cubism-A-keep-empty.*" $out -Force
Copy-Item "$job\exports\cubism-B-skip-empty.*" $out -Force
```

### 本机已生成文件指纹（2026-11-02）

| 文件 | 预期层数 | skip_empty | 字节 | SHA256 |
|------|----------|------------|------|--------|
| `cubism-A-keep-empty.psd` | 24 | false | 25696946 | `5cc0a1450bb831ed2d22da873cbb98e47952681d49914d473ed1d82a58e54216` |
| `cubism-B-skip-empty.psd` | 4 | true（跳过 20） | 9348738 | `d05c63ca3f48e0d714cfe21928f1a79cd90a76452290952ae4c88f6d325adcf0` |
| `cubism-C-cjk-names.psd`（revision-002） | 24 | false | 25696946 | `d56364e35e393c51493eaeeb233be0f2d79e8e5152e4af47730e1352bdca4b30` |

配套元数据：同目录 `*.export.json`、`MANIFEST.json`（本机）。

### A 层列表（默认保留空层，24）

自底向上（`order` 升序）：objects, wings, tail, **back hair**, footwear, legwear, bottomwear, handwear, topwear, neckwear, neck, ears, earwear, **face**, eyewhite, irides, **eyelash**, eyebrow, eyewear, nose, mouth, front hair, headwear, **head**。

标粗为 `empty=false`（有超过阈值的 alpha）。A/B 图层名为英文；中文名测试见下文 C。

### B 层列表（`--skip-empty`，4）

back hair → face → eyelash → head（相对 A 保留原 `order`：3 / 13 / 16 / 23）。

### 空层判定语义（产品说明，勿与「完全透明」混称）

导出器 `is_fully_transparent()` 使用 **`alpha_threshold=10`**（当前硬编码，本阶段不改代码）：

| Alpha 条件 | 语义 | `--skip-empty` |
|------------|------|----------------|
| 全部像素 `alpha = 0` | 数学完全透明 | 跳过 |
| 全部像素 `alpha ≤ 10`（含 1–10） | 极低透明度 / 近透明 | **也会跳过** |
| 任一点 `alpha > 10` | 可能有可见像素 | 保留 |

细半透明发丝、抗锯齿边缘若峰值 alpha ≤ 10，可能被 B 误跳过。验收时对照 A/B，记录差异；阈值可配置化留待后续，**现在不改实现**。

本 fixture 实测各层最大 Alpha：`alpha=0` 共 20 层、`1–10` 共 0 层、`>10` 共 4 层——阈值在此样本上无影响；真实立绘需按 `PHASE2-REAL-IMAGE-TEST.md` §3.1 重新统计。

保留空层（A）= 数据完整性 / 编辑审阅；清理空层（B）= 绑定准备候选。**不以 24 层默认更好**；以 Cubism 实测与人工绑定成本为准。

---

## 第一轮：PSD 格式兼容性

对 **A** 与 **B** 分别记录。状态仅允许：`PASS` / `FAIL` / `NOT TESTED`。

### A：`cubism-A-keep-empty.psd`（预期 24 层）

| 检查项 | 预期 / 备注 | 结果 | 证据（截图路径或备注） |
|--------|-------------|------|------------------------|
| 文件 SHA256 | 与上表一致 | NOT TESTED | |
| Cubism 能否正常打开 | 无崩溃、无强制转换失败 | NOT TESTED | |
| 图层数量 | 24 | NOT TESTED | |
| 中文图层名称 | 本文件为英文名；中文见下文 C | NOT TESTED | |
| 图层顺序 | 与 A 层列表一致 | NOT TESTED | |
| 画布尺寸 | 1024×1024 | NOT TESTED | |
| 图层坐标 / 位置 | 与原图画面对齐，无异常偏移 | NOT TESTED | |
| 空图层导入 | 20 个近空层是否导入异常、卡顿、后续操作异常 | NOT TESTED | |
| 隐藏图层 | 本 revision 全 visible；若另测隐藏层须注明 | NOT TESTED | |
| 透明边缘表现 | 抗锯齿 / 半透明是否异常 | NOT TESTED | |
| 明显缺失像素 | 相对原图 / reconstruction | NOT TESTED | |
| 是否可开始人工绑定 | 仅判断「能否下手」，非完整模型 | NOT TESTED | |

### B：`cubism-B-skip-empty.psd`（预期 4 层）

| 检查项 | 预期 / 备注 | 结果 | 证据 |
|--------|-------------|------|------|
| 文件 SHA256 | 与上表一致 | NOT TESTED | |
| Cubism 能否正常打开 | | NOT TESTED | |
| 图层数量 | 4（非空：back hair / face / eyelash / head） | NOT TESTED | |
| 中文图层名称 | 本 fixture 英文 | NOT TESTED | |
| 图层顺序 | 与 B 层列表一致 | NOT TESTED | |
| 画布尺寸 | 1024×1024 | NOT TESTED | |
| 图层坐标 / 位置 | | NOT TESTED | |
| 空图层 | 已跳过；确认无残留近空层 | NOT TESTED | |
| 隐藏图层 | 本 revision 全 visible | NOT TESTED | |
| 透明边缘表现 | 尤其注意 threshold 是否吃掉细边缘 | NOT TESTED | |
| 明显缺失像素 | 相对 A / 原图 | NOT TESTED | |
| 是否可开始人工绑定 | 部件是否过少影响识别 | NOT TESTED | |

### C：`cubism-C-cjk-names.psd`（中文图层名，24 层）

来源：`phase2-ingest-test` 新建独立修订 `revision-002`（parent=`original`，label=`cjk-name-acceptance`），**只做重命名**，不改像素、顺序、透明度、显隐；`original` 与 `revision-001` 未改动。不重新运行 AI 分层。

重命名操作文件（本机）：`workspace/phase2-cubism-acceptance/cjk-rename-ops.json`

| layer_id | 中文名 | 是否非空 |
|----------|--------|----------|
| head | 头部 | 是 |
| front-hair | 前发 | 否（alpha=0） |
| back-hair | 后发 | 是 |
| face | 脸部 | 是 |
| eyewhite | 眼白 | 否 |
| irides | 瞳孔 | 否 |
| eyelash | 睫毛 | 是 |
| eyebrow | 眉毛 | 否 |
| nose | 鼻子 | 否 |
| mouth | 嘴部 | 否 |
| eyewear | 饰品（眼镜） | 否（含全角括号） |

See-through 不输出左眼/右眼独立图层（只有 eyewhite / irides / eyelash），所以本次**没有**「左眼」「右眼」两个名称；左右分离属于真实立绘测试的语义问题。

导出命令：

```powershell
& $py .\services\image-pipeline\adapter\export_psd.py --job $job --revision revision-002 --out-name cubism-C-cjk-names.psd
```

| 项 | 结果 |
|----|------|
| 文件 | `cubism-C-cjk-names.psd`，25696946 字节 |
| SHA256 | `d56364e35e393c51493eaeeb233be0f2d79e8e5152e4af47730e1352bdca4b30` |
| 导出器回读（`verify_ok`） | true，errors 为空 |
| `psd_tools` 回读（`encoding="utf-8"`） | 24 层，11 个中文名逐字一致（自底向上：objects, wings, tail, 后发, footwear, legwear, bottomwear, handwear, topwear, neckwear, neck, ears, earwear, 脸部, 眼白, 瞳孔, 睫毛, 眉毛, 饰品（眼镜）, 鼻子, 嘴部, 前发, headwear, 头部） |

**已知风险（需在 Cubism 中重点确认）：** 中文名只以 UTF-8 字节写在 PSD 图层记录的旧式 Pascal 名称字段里，文件中**没有** `luni`（Unicode 图层名）附加块。用 `psd_tools` 默认编码读取时 `头部` 显示为 `Â§¥ÈÉ®`。Photoshop 一类软件通常优先读 `luni`，没有它时按系统/Mac 代码页解释旧字段，因此 Cubism 中出现乱码的可能性较高。`psd_tools` 能回读中文 ≠ Cubism 能正确显示中文。若 Cubism 实测乱码，修复方向是导出时写入 `luni` 块（属于导出器修复，另开任务，不在本次范围）。

| 检查项 | 预期 / 备注 | 结果 | 证据 |
|--------|-------------|------|------|
| 文件 SHA256 | 与上表一致 | NOT TESTED | |
| Cubism 能否正常打开 | | NOT TESTED | |
| 图层数量 | 24 | NOT TESTED | |
| 中文图层名显示 | 11 个中文名逐字正确，无乱码/截断/问号 | NOT TESTED | |
| 全角括号 `饰品（眼镜）` | 正确显示 | NOT TESTED | |
| 图层顺序 | 与 A 相同（仅改名） | NOT TESTED | |
| 画布尺寸 | 1024×1024 | NOT TESTED | |

### A vs B 观察（人工）

| 问题 | 观察 | 状态 |
|------|------|------|
| 空层是否拖累 Cubism 导入或图层管理 | | NOT TESTED |
| B 是否更适合作为绑定准备起点 | | NOT TESTED |
| 是否需要「编辑审阅 / 绑定准备」双模式（先观察，不开发） | | NOT TESTED |

---

## 第二轮：最小人工绑定（任选 A 或 B，注明文件）

目标：验证分层能否支持人工建模起步。**不要求**完整模型、**不生成** `.moc3`、不改 Live2DStage。

选用文件：________________（A / B / 其他）

| 检查项 | 结果 | 耗时 / 备注 |
|--------|------|-------------|
| 主要部件识别（头、身、眼、嘴、发等） | NOT TESTED | |
| 头发 / 眼睛 / 嘴部结构完整性 | NOT TESTED | |
| 前后遮挡关系 | NOT TESTED | |
| 网格创建（眼或发至少一处） | NOT TESTED | |
| 简单变形器创建 | NOT TESTED | |
| 遮挡 / 穿帮 / 边缘问题 | NOT TESTED | |
| 明显缺失像素（无法简单遮罩修复） | NOT TESTED | |
| 是否适合继续制作 Live2D 模型 | NOT TESTED | |

---

## 人工成本指标（产品价值）

与纯人工拆分对比时填写；单位建议分钟。

| 指标 | 说明 | 本次记录 |
|------|------|----------|
| 自动分层耗时 | AI / pipeline 运行时间 | |
| PSD 导出耗时 | `export_psd` | |
| 人工修正耗时 | 错分、缺失、边缘等 | |
| 人工绑定准备耗时 | 从 PSD 到可开始绑定 | |
| 严重缺陷数量 | 无法靠简单遮罩修复 | |
| 最终可用性 | 是否适合继续 Live2D | NOT TESTED |

\[ T_{\text{AI方案}} = T_{\text{分层}} + T_{\text{修正}} + T_{\text{绑定准备}} \]

若 AI 方案不能明显减少人工总时间，应重新考虑分层策略，而不是优先做遮罩编辑器。

---

## 结论区（全部实测后再改）

| 结论项 | 状态 |
|--------|------|
| Cubism 格式兼容性（A） | NOT TESTED |
| Cubism 格式兼容性（B） | NOT TESTED |
| Cubism 中文图层名（C） | NOT TESTED |
| 最小人工绑定可行性 | NOT TESTED |
| 是否启动 P1 遮罩编辑器 | **否**（待上列通过后再议） |

---

## 本阶段禁止事项（提醒）

- 不开发遮罩编辑器；不修改 AI 分层算法；不修改 Live2DStage。
- 不增加自动绑定；不宣称 Cubism 已验收通过。
- 不修改现有 revision 历史语义；不在此文档伪造结果。
