# 任务产物目录规范（目标设计）

适用于 `userData/live2d-jobs/<job-id>/`（Electron）以及本地验证目录  
`services/image-pipeline/workspace/jobs/<job-id>/`。

**原则：** 清单里只列真实存在的文件；未绑定时不创建虚假 `model/`。

```text
<job-id>/
├── source/
│   ├── original.png          # 或 original.jpg / .webp
│   └── source.json           # type, displayName, input_hash, 恋活元数据引用等
├── decomposition/            # AI 分层输出（See-through）
│   ├── layers/
│   ├── masks/
│   ├── depth/
│   ├── character.psd         # 若工具直接写出
│   └── layer-manifest.json
├── revisions/
│   └── revision-001/
│       ├── layers/
│       └── revision.json
├── exports/
│   └── character.psd
├── model/                    # 仅在人工绑定并导入后出现
│   ├── *.model3.json
│   ├── *.moc3
│   ├── textures/
│   ├── motions/
│   ├── expressions/
│   └── *physics3.json
├── logs/
│   └── pipeline.log
└── job.json
```

## `layer-manifest.json`（最小字段）

```json
{
  "pipeline": "see-through",
  "pipeline_version": "vendor-git-sha-or-tag",
  "model_version": "layerdiff-v3-nf4",
  "backend": "inference_psd_quantized",
  "input_hash": "sha256:…",
  "created_at": "ISO-8601",
  "layers": [
    { "id": "hair_front", "file": "layers/hair_front.png", "order": 10, "visible": true }
  ],
  "psd": "character.psd",
  "notes": []
}
```

## 与当前 `job.json` 的关系

现有字段（`status`, `sourceName`, `displayName`, `characterId`, `resultKind`, …）保留。  
阶段 1 建议追加：

| 字段 | 含义 |
|------|------|
| `phase` | 细状态：`decomposing` / `needs_review` / `awaiting_rigging` 等 |
| `resultKind` | `preview-placeholder` \| `mock-haru` \| `decomposition` \| `live2d-pack` |
| `live2d_ready` | **仅**在真实 moc 包验证通过后可为 true；分层/审阅阶段必须为 false |
| `activeRevision` | 当前审阅版本 id（`original` / `revision-NNN`） |
| `artifacts` | 相对路径列表 |
| `pipeline_version` / `model_version` | 可追溯 |
| `error_code` | 可诊断失败 |
