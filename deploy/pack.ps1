# multi-agent-writer v3.0 distribution packer
# Output: dist/multi-agent-writer-v3.0.zip (clean bundle, no personal data)
# Usage (from project root):  powershell -File deploy\pack.ps1
#   (No args needed if SKILL.md exists at project root; otherwise pass -SkillsDir)
# NOTE: keep this script ASCII-only so it runs under any PowerShell version/encoding.

param(
  # Directory where the multi-agent-writer skill is installed (e.g. C:\Users\<you>\SKILLs)
  [string]$SkillsDir = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path          # project root (parent of deploy/)
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "stage\multi-agent-writer"
$zip = Join-Path $dist "multi-agent-writer-v3.0.zip"

# 1. clean previous artifacts
if (Test-Path (Join-Path $dist "stage")) { Remove-Item (Join-Path $dist "stage") -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# 2. copy core files (whitelist mode: only what distribution needs)
# SKILL.md: prefer the mirror at project root (kept in sync by deploy\sync-skillmd.ps1);
# fall back to -SkillsDir when the root copy is missing.
$skillMd = Join-Path $root "SKILL.md"
if (-not (Test-Path $skillMd)) {
  if (-not $SkillsDir) { Write-Host "No SKILL.md at project root and no -SkillsDir given. Run deploy\sync-skillmd.ps1 first. Abort."; exit 1 }
  $skillMd = Join-Path $SkillsDir "multi-agent-writer\SKILL.md"
}
if (-not (Test-Path $skillMd)) { Write-Host "SKILL.md not found. Abort."; exit 1 }
Copy-Item $skillMd $stage
Copy-Item (Join-Path $root "README.md")         $stage
Copy-Item (Join-Path $root "src")               $stage -Recurse
Copy-Item (Join-Path $root "deploy")            $stage -Recurse

# 3. red-line checks: never bundle
#    - private experience.md / style-profile.md (only blank seeds under deploy/seeds/)
#    - output/ interim/ artifacts
#    - node_modules / dist / logs
$forbidden = @()
Get-ChildItem $stage -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($stage.Length + 1)
  if ($rel -notmatch "seeds" -and $_.Name -in @("experience.md", "style-profile.md", "platform.json")) {
    $forbidden += "private data file: $rel"
  }
  if ($rel -match "^(output|interim|node_modules|dist)[\\/]") { $forbidden += "artifact: $rel" }
}
if ($forbidden.Count -gt 0) {
  Write-Host "Pack aborted, red-line check failed:"
  $forbidden | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

# 4. seed sanity check: seeds must be blank profiles (no personal data)
# Chinese section titles are built from code points to keep this script pure ASCII
$zhRunLog = -join ([char]0x8FD0,[char]0x884C,[char]0x65E5,[char]0x5FD7)      # run-log section title
$zhLessons = -join ([char]0x7ECF,[char]0x9A8C,[char]0x6761,[char]0x76EE)    # lessons section title
$seedExp = Get-Content (Join-Path $stage "deploy\seeds\experience-seed.md") -Raw -Encoding UTF8
if ($seedExp -notmatch $zhRunLog -or $seedExp -notmatch $zhLessons) { Write-Host "Seed file structure check failed (expect run-log + lesson sections)."; exit 1 }

# 5. compress
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist "stage\multi-agent-writer") -DestinationPath $zip -Force
Remove-Item (Join-Path $dist "stage") -Recurse -Force

# 6. report
$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "Pack done: $zip ($size KB)"
Write-Host "Content: SKILL.md + README.md + src/ + deploy/ (INSTALL.md / platform-template.json / seeds)"
Write-Host "Deploy: recipient unzips, tells their agent 'install multi-agent-writer'; agent follows deploy/INSTALL.md"
