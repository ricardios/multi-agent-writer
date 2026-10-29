# Sync script: runtime SKILL.md (skill dir) -> distribution mirror (project root, for git)
# Usage: powershell -File deploy\sync-skillmd.ps1 -SkillsDir "<dir where multi-agent-writer skill is installed>"
# Example: powershell -File deploy\sync-skillmd.ps1 -SkillsDir "C:\Users\<you>\SKILLs"
# Run this after upgrading SKILL.md, before git commit or packing.
# NOTE: keep this script ASCII-only so it runs under any PowerShell version/encoding.

param(
  [Parameter(Mandatory = $true)]
  [string]$SkillsDir
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path
$src = Join-Path $SkillsDir "multi-agent-writer\SKILL.md"
$dst = Join-Path $root "SKILL.md"

if (-not (Test-Path $src)) { Write-Host "Runtime SKILL.md not found: $src"; exit 1 }
Copy-Item $src $dst -Force
$hash = (Get-FileHash $dst -Algorithm SHA256).Hash.Substring(0, 12)
Write-Host "SKILL.md synced to project root: $dst (sha256:$hash)"
Write-Host "Verify then commit / pack."
