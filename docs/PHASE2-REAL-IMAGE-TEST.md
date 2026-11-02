# Phase 2：真实立绘端到端测试规范

> **状态：** 规范与记录模板已就绪；**尚未**运行任何真实立绘样本。  
> 无实际运行证据的项一律为 `NOT TESTED`。禁止把 `NOT TESTED` 改成 `PASS` 而无证据。  
> 本文件不涉及新功能开发：不做遮罩编辑器、不改 See-through 推理、不改 Live2DStage、不做自动绑定、不改 revision 历史语义。

## 1. 与现有 fixture 的分工

| 样本 | 用途 | 不能证明什么 |
|------|------|--------------|
| `phase2-ingest-test`（合成测试图 `fixtures/sample.png`） | **PSD 导出器回归样本**：默认保留空层、`--skip-empty`、层数/顺序/名称/透明度、`psd_tools` 回读一致性 | AI 分层质量；能否支撑 Live2D 建模 |
| 本文 A / B / C 真实立绘 | 阶段 2 **分层质量与人工成本**验收 | — |

`phase2-ingest-test` 只有 4 个非空层（back hair / face / eyelash / head），20 个空层 Alpha 全为 0。它无法回答长发分离、前后发遮挡、眼部细分、服装拆分、手臂与身体交叠等问题。**不得**以它作为阶段 2 的最终验收依据。

## 2. 样本选择

有意选择三种难度，不用简单头像：

| 样本 | 侧重 | 选择要点 |
|------|------|----------|
| **A** 长发复杂 | 长发、刘海、发丝交叠、细半透明发梢 | 前发明显盖住眼睛/脸 |
| **B** 服装复杂 | 多层衣物、手臂与身体遮挡 | 至少一只手臂压在躯干前 |
| **C** 细节复杂 | 饰品、眼部细节、小部件 | 耳饰/发饰/眼镜等小件 ≥ 2 |

共同要求：

- **有权使用**（自绘、委托含使用权、明确许可的素材）；记录来源与授权依据，不使用来路不明的图。
- 尽量完整身体或至少半身，长边 ≥ 1500 px，背景干净或透明。
- 原始文件只读保存，记录 SHA256；后续所有产物可追溯到该哈希。

## 3. 执行流程（每个样本）

```powershell
cd F:\restore\github-local-repository\furiberto-first-repository
$py  = ".\services\image-pipeline\.venv\Scripts\python.exe"
$img = "<样本路径>.png"
$tag = "real-A"                      # real-A / real-B / real-C
$p0  = ".\services\image-pipeline\workspace\phase0\$tag"
$job = ".\services\image-pipeline\workspace\jobs\$tag"

Get-FileHash $img -Algorithm SHA256

# 1) See-through 分层（NF4 量化，默认 resolution=1024）；用 Measure-Command 记耗时
Measure-Command {
  powershell -ExecutionPolicy Bypass -File services/image-pipeline/scripts/run-phase0-decompose.ps1 `
    -Image $img -OutDir $p0 -Backend see-through-quantized -Resolution 1024
}
# 运行期间另开终端记录显存峰值：
#   nvidia-smi --query-gpu=memory.used --format=csv -l 1

# 2) 规范化进任务目录
& $py .\services\image-pipeline\adapter\ingest_phase0.py --src $p0 --out $job

# 3) 在桌宠「图层审阅」中检查；轻量修正保存为新 revision（不改 original）

# 4) 导出 PSD（原始 + 修订各一份；需要时再加 --skip-empty）
& $py .\services\image-pipeline\adapter\export_psd.py --job $job --revision original --out-name "$tag-original.psd"
& $py .\services\image-pipeline\adapter\export_psd.py --job $job --revision <revision-NNN> --out-name "$tag-<revision-NNN>.psd"
Get-FileHash "$job\exports\$tag-original.psd" -Algorithm SHA256
```

### 3.1 图层 Alpha 统计（判断 `alpha_threshold=10` 是否有影响）

导出器在 `--skip-empty` 时把「所有像素 alpha ≤ 10」的层当作空层跳过。真实立绘先**统计**，暂不改阈值、不做成配置参数：

```powershell
@'
import json, sys
from pathlib import Path
from PIL import Image
job = Path(sys.argv[1])
m = json.loads((job / "decomposition" / "layer-manifest.json").read_text(encoding="utf-8"))
b = {"alpha_0": [], "alpha_1_10": [], "alpha_gt_10": []}
for L in m["layers"]:
    if L.get("kind", "part") != "part":
        continue
    mx = Image.open(job / "decomposition" / L["file"]).convert("RGBA").getchannel("A").getextrema()[1]
    b["alpha_0" if mx == 0 else "alpha_1_10" if mx <= 10 else "alpha_gt_10"].append(f'{L["id"]}(max={mx})')
for k, v in b.items():
    print(k, len(v), v)
'@ | & $py - $job
```

参考：`phase2-ingest-test` 结果为 `alpha_0=20`、`alpha_1_10=0`、`alpha_gt_10=4`，阈值在该样本上无影响。

若真实样本出现 `alpha_1_10 > 0`，须在下表记录这些层的语义（细发丝 / 半透明饰品 / 抗锯齿残留 / 噪声），再决定是否调整阈值。

## 4. 缺陷分类

| 代码 | 类型 | 示例 | 局部遮罩能否解决 |
|------|------|------|------------------|
| D1 | 区域归属错误 | 一缕头发进入脸部层 | 通常可以（擦除 + 移入正确层） |
| D2 | 边缘残留 / 透明度问题 | 发丝边缘带背景色、半透明被截断 | 部分可以 |
| D3 | 部件缺失 | 被前发遮挡的眼睛/额头无像素 | **不可以**（无法凭空恢复，需补画） |
| D4 | 遮挡关系错误 | 前发与后发层级颠倒、手臂压在错误层后 | 通常不能只靠遮罩（需重排或重分） |
| D5 | 图层命名 / 语义错误 | 饰品被标为 headwear、左右不分 | 不能（需重命名或重分类） |

遮罩编辑器解决的是**像素归属与透明度**，不是语义分层错误的通用修复工具。P1 是否开发遮罩，取决于真实样本中 D1/D2 与 D3/D4/D5 的占比与修复耗时。

缺陷登记格式（每个样本一张表）：

| # | 代码 | 涉及图层 | 描述 | 严重（阻断绑定？） | 修复方式 | 修复耗时（分钟） | 遮罩可解？ |
|---|------|----------|------|--------------------|----------|------------------|------------|

## 5. 样本记录

### 样本 A：长发复杂

| 项 | 记录 | 状态 |
|----|------|------|
| 图片来源 | | NOT TESTED |
| 授权依据 | | NOT TESTED |
| 原始文件 SHA256 | | NOT TESTED |
| 输入分辨率 | | NOT TESTED |
| See-through 配置（backend / resolution / group-offload） | | NOT TESTED |
| GPU 型号 / 显存峰值 | | NOT TESTED |
| AI 分层耗时 | | NOT TESTED |
| 输出总图层数 | | NOT TESTED |
| 非空图层数（alpha_gt_10） | | NOT TESTED |
| Alpha 统计（0 / 1–10 / >10） | | NOT TESTED |
| 缺陷数量（D1 / D2 / D3 / D4 / D5） | | NOT TESTED |
| 人工修正耗时 | | NOT TESTED |
| PSD 导出结果（文件名 + SHA256 + verify_ok） | | NOT TESTED |
| Cubism 导入结果 | | NOT TESTED |
| 最小人工绑定（能否开始 / 耗时） | | NOT TESTED |

缺陷登记：

| # | 代码 | 涉及图层 | 描述 | 严重 | 修复方式 | 耗时 | 遮罩可解？ |
|---|------|----------|------|------|----------|------|------------|

### 样本 B：服装复杂

| 项 | 记录 | 状态 |
|----|------|------|
| 图片来源 | | NOT TESTED |
| 授权依据 | | NOT TESTED |
| 原始文件 SHA256 | | NOT TESTED |
| 输入分辨率 | | NOT TESTED |
| See-through 配置（backend / resolution / group-offload） | | NOT TESTED |
| GPU 型号 / 显存峰值 | | NOT TESTED |
| AI 分层耗时 | | NOT TESTED |
| 输出总图层数 | | NOT TESTED |
| 非空图层数（alpha_gt_10） | | NOT TESTED |
| Alpha 统计（0 / 1–10 / >10） | | NOT TESTED |
| 缺陷数量（D1 / D2 / D3 / D4 / D5） | | NOT TESTED |
| 人工修正耗时 | | NOT TESTED |
| PSD 导出结果（文件名 + SHA256 + verify_ok） | | NOT TESTED |
| Cubism 导入结果 | | NOT TESTED |
| 最小人工绑定（能否开始 / 耗时） | | NOT TESTED |

缺陷登记：

| # | 代码 | 涉及图层 | 描述 | 严重 | 修复方式 | 耗时 | 遮罩可解？ |
|---|------|----------|------|------|----------|------|------------|

### 样本 C：饰品与细节复杂

| 项 | 记录 | 状态 |
|----|------|------|
| 图片来源 | | NOT TESTED |
| 授权依据 | | NOT TESTED |
| 原始文件 SHA256 | | NOT TESTED |
| 输入分辨率 | | NOT TESTED |
| See-through 配置（backend / resolution / group-offload） | | NOT TESTED |
| GPU 型号 / 显存峰值 | | NOT TESTED |
| AI 分层耗时 | | NOT TESTED |
| 输出总图层数 | | NOT TESTED |
| 非空图层数（alpha_gt_10） | | NOT TESTED |
| Alpha 统计（0 / 1–10 / >10） | | NOT TESTED |
| 缺陷数量（D1 / D2 / D3 / D4 / D5） | | NOT TESTED |
| 人工修正耗时 | | NOT TESTED |
| PSD 导出结果（文件名 + SHA256 + verify_ok） | | NOT TESTED |
| Cubism 导入结果 | | NOT TESTED |
| 最小人工绑定（能否开始 / 耗时） | | NOT TESTED |

缺陷登记：

| # | 代码 | 涉及图层 | 描述 | 严重 | 修复方式 | 耗时 | 遮罩可解？ |
|---|------|----------|------|------|----------|------|------------|

## 6. 人工基线对比（至少一张）

选 A/B/C 中一张，按**相同部件划分标准**分别记录纯人工拆分与 AI 辅助拆分：

| 方式 | 拆分 / 分层 | 修正 | 绑定准备 | 合计 | 状态 |
|------|-------------|------|----------|------|------|
| 纯人工 | | — | | | NOT TESTED |
| AI 辅助 | | | | | NOT TESTED |

\[ T_{\text{AI方案}} = T_{\text{分层}} + T_{\text{修正}} + T_{\text{绑定准备}} \]

若 \(T_{\text{AI方案}}\) 不明显小于纯人工合计，优先重新考虑分层策略，而不是继续增加编辑功能。

## 7. 汇总与决策（全部样本完成后再填）

| 问题 | 结论 | 状态 |
|------|------|------|
| 至少一张真实立绘能否在 Cubism 中开始建模 | | NOT TESTED |
| D1+D2（遮罩可解）占全部缺陷的比例 | | NOT TESTED |
| D3+D4+D5（遮罩不可解）是否为主要阻断项 | | NOT TESTED |
| `alpha_threshold=10` 是否误伤真实细节 | | NOT TESTED |
| 是否启动 P1 局部遮罩编辑器 | **待定**（取决于上两行） | NOT TESTED |

## 8. 中期规划备忘（本阶段不实现）

- **状态分离**：`decomposition_ready` / `review_ready` / `psd_export_ready` / `cubism_verified` / `live2d_ready` 互不替代；`cubism_verified` 只记录真实人工验收结果，PSD 导出成功后**不得**自动置位。`live2d_ready` 仅在导入可播放模型包后才可为 true。
- **可追溯性**：revision 未来补充 manifest 哈希、原图哈希、遮罩哈希；PSD 导出记录对应 revision ID（已有）。
- **运行时隔离**：桌宠播放已有 Live2D 不依赖 AI 分层服务；See-through / 显卡 / Python 环境故障不得影响已有角色播放。
