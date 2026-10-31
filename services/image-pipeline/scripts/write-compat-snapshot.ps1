# Append a machine snapshot snippet for PHASE0-COMPAT.md
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Out = Join-Path (Split-Path -Parent $PSScriptRoot) "workspace\compat-snapshot.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null

$lines = @()
$lines += "snapshot=$(Get-Date -Format o)"
$lines += "node=$(node -v)"
$lines += "npm=$(npm -v)"
$lines += "python=$(python --version 2>&1)"
try {
  $gpu = nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
  $lines += "gpu=$gpu"
} catch {
  $lines += "gpu=unavailable"
}
$pkg = Join-Path $Root "package.json"
if (Test-Path $pkg) {
  $json = Get-Content $pkg -Raw | ConvertFrom-Json
  $lines += "pixi.js=$($json.dependencies.'pixi.js')"
  $lines += "pixi-live2d-display=$($json.dependencies.'pixi-live2d-display')"
  $lines += "electron=$($json.devDependencies.electron)"
}

$lines | Set-Content -Path $Out -Encoding utf8
Write-Host "Wrote $Out"
Get-Content $Out
