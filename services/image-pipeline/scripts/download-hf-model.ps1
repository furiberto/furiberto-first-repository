param(
  [Parameter(Mandatory = $true)][string]$RepoId,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$Mirror = "https://hf-mirror.com"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tree = Join-Path $env:TEMP ("hf-tree-" + ($RepoId -replace '[\\/]', '-') + ".json")
$treeUrl = "$Mirror/api/models/$RepoId/tree/main?recursive=1"
Write-Host "[dl] tree $treeUrl"
curl.exe -L --retry 5 --retry-all-errors --connect-timeout 30 --max-time 120 -o $tree $treeUrl
if ($LASTEXITCODE -ne 0) { throw "tree download failed" }

$py = Join-Path (Split-Path -Parent $PSScriptRoot) ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$files = & $py -c "import json; from pathlib import Path; d=json.loads(Path(r'$tree').read_text(encoding='utf-8')); print('\n'.join(x['path'] for x in d if x.get('type')=='file'))"
$list = $files -split "`n" | Where-Object { $_.Trim() -ne "" }
Write-Host "[dl] $($list.Count) files -> $OutDir"

foreach ($rel in $list) {
  $rel = $rel.Trim()
  $dest = Join-Path $OutDir ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  $url = "$Mirror/$RepoId/resolve/main/$($rel -replace '\\','/')"
  Write-Host "[dl] $rel"
  curl.exe -L --retry 20 --retry-all-errors --retry-delay 2 --connect-timeout 60 -C - -o $dest $url
  if ($LASTEXITCODE -ne 0) { throw "failed: $rel exit=$LASTEXITCODE" }
  $sz = (Get-Item $dest).Length
  if ($sz -lt 10) { throw "too small: $rel ($sz)" }
  Write-Host "  ok $([math]::Round($sz/1MB,2)) MB"
}
Write-Host "[dl] DONE $RepoId"
