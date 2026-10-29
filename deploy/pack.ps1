# multi-agent-writer v3.0 分发包打包脚本
# 产物：dist/multi-agent-writer-v3.0.zip（干净分发包，不含任何个人数据）
# 用法：在 multi-agent-writer 项目根目录执行  powershell -File deploy\pack.ps1
#        （项目根已有 SKILL.md 时无需额外参数；若项目根没有，传 -SkillsDir 指向安装本技能的目录）

param(
  # 安装 multi-agent-writer 技能的目录（如 C:\Users\<你>\SKILLs），仅项目根无 SKILL.md 时需要
  [string]$SkillsDir = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path          # 项目根（deploy/ 的上级）
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "stage\multi-agent-writer"
$zip = Join-Path $dist "multi-agent-writer-v3.0.zip"

# 1. 清理旧产物
if (Test-Path (Join-Path $dist "stage")) { Remove-Item (Join-Path $dist "stage") -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# 2. 复制核心文件（白名单制：只打包分发需要的，杜绝夹带）
# SKILL.md 优先用项目根的分发镜像（由 deploy\sync-skillmd.ps1 从技能目录同步而来）；
# 项目根没有时用 -SkillsDir 指定的技能目录
$skillMd = Join-Path $root "SKILL.md"
if (-not (Test-Path $skillMd)) {
  if (-not $SkillsDir) { Write-Host "项目根无 SKILL.md 且未传 -SkillsDir，中止（或先跑 deploy\sync-skillmd.ps1）"; exit 1 }
  $skillMd = Join-Path $SkillsDir "multi-agent-writer\SKILL.md"
}
if (-not (Test-Path $skillMd)) { Write-Host "找不到 SKILL.md，中止"; exit 1 }
Copy-Item $skillMd $stage
Copy-Item (Join-Path $root "README.md")         $stage
Copy-Item (Join-Path $root "src")               $stage -Recurse
Copy-Item (Join-Path $root "deploy")            $stage -Recurse

# 3. 红线校验：分发包内绝不出现
#    - 部署者的 experience.md / style-profile.md 私有数据（只允许 deploy/seeds/ 下的空白种子）
#    - output/ / interim/ 历史产物
#    - node_modules / dist / 运行日志
$forbidden = @()
Get-ChildItem $stage -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($stage.Length + 1)
  if ($rel -notmatch "seeds" -and $_.Name -in @("experience.md", "style-profile.md", "platform.json")) {
    $forbidden += "私有数据文件: $rel"
  }
  if ($rel -match "^(output|interim|node_modules|dist)[\\/]") { $forbidden += "历史产物: $rel" }
}
if ($forbidden.Count -gt 0) {
  Write-Host "打包中止，红线校验失败："
  $forbidden | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

# 4. 种子内容复核：seeds 必须是空白档案（无个人偏好、无运行日志）
$seedExp = Get-Content (Join-Path $stage "deploy\seeds\experience-seed.md") -Raw -Encoding UTF8
if ($seedExp -notmatch "运行日志" -or $seedExp -notmatch "经验条目") { Write-Host "种子文件结构异常"; exit 1 }

# 5. 压缩
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist "stage\multi-agent-writer") -DestinationPath $zip -Force
Remove-Item (Join-Path $dist "stage") -Recurse -Force

# 6. 报告
$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "打包完成: $zip ($size KB)"
Write-Host "内容: SKILL.md + README.md + src/ + deploy/（INSTALL.md / platform-template.json / seeds）"
Write-Host "部署方式: 对方平台拿到 zip 后，对 agent 说『帮我部署 multi-agent-writer』，agent 读 deploy/INSTALL.md 执行"
