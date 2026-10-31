# Image Pipeline（独立于桌宠 Node 环境）

本目录是 **Job Orchestrator 之外的 Python 推理侧**骨架。  
第一阶段后端目标：[See-through](https://github.com/shitagaki-lab/see-through)（分层 + 补全 → PSD），**不是**自动导出 `.moc3`。

## 为什么独立

- See-through 需要 Python 3.12、PyTorch、CUDA、大量显存；与 Electron / Vite 依赖冲突。
- 桌宠只负责任务调度、读产物、播放已绑定模型。

## 本机约束（见 `docs/PHASE0-COMPAT.md`）

当前探测：**RTX 5060 Laptop ≈ 8 GB VRAM**。  
请使用官方 **NF4 量化**脚本，不要用默认 bf16@1280：

```text
inference/scripts/inference_psd_quantized.py
```

本机已验证：`--resolution 1024 --no_group_offload`，峰值显存约 **5.3 GB**，总时长约 **10 分钟**。  
默认 `group_offload` 在本机曾触发 CUBLAS/设备错误，适配器默认关闭。

## 目录

```text
services/image-pipeline/
├── README.md
├── requirements-adapter.txt
├── requirements-see-through-inference.txt
├── scripts/
│   ├── setup-see-through.ps1
│   ├── run-phase0-decompose.ps1
│   ├── download-hf-model.ps1
│   └── write-compat-snapshot.ps1
├── adapter/
│   ├── decompose_cli.py
│   └── layer_manifest.py
├── fixtures/
├── vendor/                   # see-through（gitignore）
└── workspace/                # 模型与运行产物（gitignore）
```

## 阶段 0 操作步骤（本机已验证）

无 conda 时使用仓库内 `.venv`。

### 1. 获取上游源码

```powershell
npm run pipeline:image:setup
# git 失败时用 codeload zip（见 setup 脚本回退）
```

### 2. 安装推理环境

```powershell
python -m venv services/image-pipeline/.venv
.\services\image-pipeline\.venv\Scripts\python.exe -m pip install -U pip
# torch 可用 curl 断点续传到 workspace/wheels 再本地 pip install
.\services\image-pipeline\.venv\Scripts\python.exe -m pip install torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128
.\services\image-pipeline\.venv\Scripts\python.exe -m pip install -e .\services\image-pipeline\vendor\see-through\common -e .\services\image-pipeline\vendor\see-through\annotators
.\services\image-pipeline\.venv\Scripts\python.exe -m pip install -r .\services\image-pipeline\requirements-see-through-inference.txt
.\services\image-pipeline\.venv\Scripts\python.exe -m pip install -U bitsandbytes
```

### 3. 下载 NF4 权重（推荐 hf-mirror + curl）

```powershell
powershell -ExecutionPolicy Bypass -File services/image-pipeline/scripts/download-hf-model.ps1 `
  -RepoId 24yearsold/seethroughv0.0.2_layerdiff3d_nf4 `
  -OutDir services/image-pipeline/workspace/models/seethroughv0.0.2_layerdiff3d_nf4
powershell -ExecutionPolicy Bypass -File services/image-pipeline/scripts/download-hf-model.ps1 `
  -RepoId 24yearsold/seethroughv0.0.1_marigold_nf4 `
  -OutDir services/image-pipeline/workspace/models/seethroughv0.0.1_marigold_nf4
```

### 4. 跑一张图

```powershell
cd services/image-pipeline
powershell -ExecutionPolicy Bypass -File .\scripts\run-phase0-decompose.ps1 `
  -Image .\fixtures\sample.png -Backend see-through-quantized
```

或直接：

```powershell
.\.venv\Scripts\python.exe adapter\decompose_cli.py `
  --image fixtures\sample.png `
  --out workspace\phase0\run `
  --backend see-through-quantized `
  --resolution 1024
```

参考产物：`workspace/phase0/first-run/sample.psd`。

### 5. Haru 回归

```powershell
npm run open
```

确认内置 Haru 动作与物理正常。

## 适配器 CLI / 桌宠集成（阶段 1）

```powershell
# 仅目录脚手架
npm run pipeline:image:dry-run

# Electron：角色工作室任务行上点「AI 分层」→ spawn 本适配器 → status=needs_review
# 高级选项里有「分层 dry-run」。产物在 userData/live2d-jobs/<id>/exports/
```

```powershell
python adapter/decompose_cli.py --image fixtures/sample.png --out workspace/jobs/demo --dry-run
python adapter/decompose_cli.py --image fixtures/sample.png --out workspace/jobs/demo --backend see-through-quantized
```

环境变量：`SEE_THROUGH_ROOT`、`IMAGE_PIPELINE_PYTHON`。

## 许可证提醒

See-through 声明 Apache-2.0；模型权重与依赖需单独核查后再用于发行版产品。
