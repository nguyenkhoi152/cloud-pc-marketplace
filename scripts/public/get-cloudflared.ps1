<#
.SYNOPSIS
  Tai cloudflared (phien ban GHIM trong scripts\public\cloudflared.json) va KIEM SHA-256 truoc khi dung. Khong chay file.
.DESCRIPTION
  Chi tai tu URL da ghim. Tai vao tep tam, kiem kich thuoc + SHA-256 khop gia tri ghim roi moi doi ten thanh dich. Sai la xoa tep tam va bao loi.
  Neu dich da co va dung SHA-256 thi khong tai lai.
  Dung:  powershell -File scripts\public\get-cloudflared.ps1 [-Out C:\cpm-demo\bin\cloudflared.exe]
#>
param([string]$Out = "C:\cpm-demo\bin\cloudflared.exe")
$ErrorActionPreference = "Stop"
$pin = (Get-Content (Join-Path $PSScriptRoot "cloudflared.json") -Raw | ConvertFrom-Json).windowsAmd64
if ($pin.url -notmatch '^https://github\.com/cloudflare/cloudflared/releases/download/[0-9.]+/cloudflared-windows-amd64\.exe$') { throw "URL ghim khong dung dang" }
function Sha($p) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }
if ((Test-Path $Out) -and ((Sha $Out) -eq $pin.sha256)) { Write-Host "cloudflared da co va dung SHA-256: $Out"; exit 0 }
New-Item -Force -ItemType Directory (Split-Path $Out) | Out-Null
$tmp = "$Out.download"
Remove-Item -Force $tmp -ErrorAction SilentlyContinue
Write-Host "Tai cloudflared (ghim) ..."
Invoke-WebRequest -Uri $pin.url -OutFile $tmp -UseBasicParsing
$len = (Get-Item $tmp).Length
if ($len -ne $pin.bytes -or (Sha $tmp) -ne $pin.sha256) { Remove-Item -Force $tmp; throw "cloudflared tai ve KHONG khop kich thuoc/SHA-256 ghim - da xoa, KHONG dung." }
Move-Item -Force $tmp $Out
Write-Host "OK: $Out ($([Math]::Round($len / 1MB, 1)) MiB, SHA-256 khop ban ghim)"
