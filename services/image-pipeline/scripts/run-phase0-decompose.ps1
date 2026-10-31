param(
  [Parameter(Mandatory = $true)][string]$Image,
  [string]$OutDir = "",
  [ValidateSet("dry-run", "see-through-quantized")][string]$Backend = "see-through-quantized",
  [int]$Resolution = 1024
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Adapter = Join-Path $Root "adapter\decompose_cli.py"

if (-not (Test-Path $Image)) {
  throw "Image not found: $Image"
}

if (-not $OutDir) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutDir = Join-Path $Root "workspace\phase0\$stamp"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "[phase0] image=$Image"
Write-Host "[phase0] out=$OutDir"
Write-Host "[phase0] backend=$Backend resolution=$Resolution"

$Python = "python"
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (Test-Path $venvPy) {
  $Python = $venvPy
} elseif ($env:CONDA_PREFIX) {
  $cand = Join-Path $env:CONDA_PREFIX "python.exe"
  if (Test-Path $cand) { $Python = $cand }
}

Write-Host "[phase0] python=$Python"
& $Python $Adapter --image $Image --out $OutDir --backend $Backend --resolution $Resolution
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[phase0] fill docs/PHASE0-COMPAT.md section 6 if needed; npm run open for Haru regression."
