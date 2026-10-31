# Fetch See-through into vendor/ (does NOT install CUDA/PyTorch).
# Prefer git; on reset/timeout fall back to GitHub codeload zip.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $Root "vendor"
$Target = Join-Path $Vendor "see-through"
$Repo = "https://github.com/shitagaki-lab/see-through.git"
$ZipUrl = "https://codeload.github.com/shitagaki-lab/see-through/zip/refs/heads/main"
$ZipPath = Join-Path $Vendor "see-through.zip"

New-Item -ItemType Directory -Force -Path $Vendor | Out-Null

function Install-FromZip {
  Write-Host "[setup] downloading zip via codeload (may take several minutes)..."
  if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
  curl.exe -L --retry 8 --retry-all-errors --retry-delay 3 --connect-timeout 60 --max-time 900 -o $ZipPath $ZipUrl
  if ($LASTEXITCODE -ne 0) { throw "zip download failed (exit $LASTEXITCODE)" }
  $len = (Get-Item $ZipPath).Length
  if ($len -lt 5000000) { throw "zip too small ($len bytes) — incomplete download" }
  if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
  Get-ChildItem $Vendor -Directory | Where-Object { $_.Name -like "see-through*" } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Vendor -Force
  $extracted = Get-ChildItem $Vendor -Directory |
    Where-Object { $_.Name -like "see-through-*" -or $_.Name -eq "see-through" } |
    Select-Object -First 1
  if (-not $extracted) { throw "zip extract produced no see-through folder" }
  if ($extracted.FullName -ne $Target) { Rename-Item $extracted.FullName "see-through" }
  Write-Host "[setup] zip install OK ($len bytes)"
}

if ((Test-Path (Join-Path $Target "README.md")) -and (Test-Path (Join-Path $Target "inference"))) {
  Write-Host "[setup] already present: $Target"
} elseif (Test-Path (Join-Path $Target ".git")) {
  Write-Host "[setup] updating git clone: $Target"
  Push-Location $Target
  git fetch --depth 1 origin
  git pull --ff-only
  Pop-Location
} else {
  Write-Host "[setup] cloning $Repo"
  git clone --depth 1 $Repo $Target
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $Target "README.md"))) {
    Write-Host "[setup] git clone failed; falling back to zip"
    if (Test-Path $Target) { Remove-Item -Recurse -Force $Target -ErrorAction SilentlyContinue }
    Install-FromZip
  }
}

$Assets = Join-Path $Target "assets"
$CommonAssets = Join-Path $Target "common\assets"
if (-not (Test-Path $Assets) -and (Test-Path $CommonAssets)) {
  Write-Host "[setup] creating junction assets -> common\assets"
  cmd /c "mklink /J `"$Assets`" `"$CommonAssets`""
}

Write-Host ""
Write-Host "Next (in a conda env named see_through, Python 3.12):"
Write-Host "  cd $Target"
Write-Host "  pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128"
Write-Host "  pip install -r requirements.txt"
Write-Host "  pip install -r requirements-inference-bnb.txt"
Write-Host ""
Write-Host "This machine has ~8GB VRAM: use inference_psd_quantized.py (see README)."
Write-Host "Do NOT install these packages into the DesktopPet Node/Electron environment."
