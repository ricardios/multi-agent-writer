# 同步脚本：技能目录的运行版 SKILL.md → 项目根的分发版（git 入库用）
# 用法：powershell -File deploy\sync-skillmd.ps1 -SkillsDir <安装 multi-agent-writer 的技能目录>
#        示例：powershell -File deploy\sync-skillmd.ps1 -SkillsDir "C:\Users\<你>\<技能目录>"
# 说明：技能目录（运行正本）与项目根（分发镜像）双位置，本脚本保证镜像与正本一致。
#       升级 SKILL.md 后、git 提交或打包前执行。

param(
  [Parameter(Mandatory = $true)]
  [string]$SkillsDir
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path
$src = Join-Path $SkillsDir "multi-agent-writer\SKILL.md"
$dst = Join-Path $root "SKILL.md"

if (-not (Test-Path $src)) { Write-Host "找不到运行版 SKILL.md: $src"; exit 1 }
Copy-Item $src $dst -Force
$hash = (Get-FileHash $dst -Algorithm SHA256).Hash.Substring(0, 12)
Write-Host "SKILL.md 已同步到项目根: $dst (sha256:$hash)"
Write-Host "确认无误后提交/打包"
