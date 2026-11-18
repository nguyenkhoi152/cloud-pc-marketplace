<#
.SYNOPSIS
  Mo app Cloud PC Companion DA CAI voi ho so trinh duyet rieng cho tung vai tro, de demo hai vai tren MOT may:
  mot cua so "host" (cho thue may) va mot cua so "renter" (thue may), moi cua so dang nhap mot tai khoan khac nhau.
.DESCRIPTION
  App luu phien dang nhap va khoa VI GIA LAP trong du lieu WebView2. Hai cua so dung chung du lieu se chung tai khoan,
  nen script dat WEBVIEW2_USER_DATA_FOLDER rieng cho moi vai tro (thu muc trong %LOCALAPPDATA%\dev.cloudpc.companion).
  Khong doi cai dat he thong. Dong cua so host = dung nhan thue (agent trong guest tu dung va don guest).
#>
param([Parameter(Mandatory = $true)][ValidateSet("host", "renter")][string]$Role)
$exe = Join-Path $env:LOCALAPPDATA "Cloud PC Companion\cloud-pc-companion.exe"
if (-not (Test-Path $exe)) { throw "Chua thay app da cai tai $exe. Chay bo cai NSIS truoc (xem docs\DEMO_RUNBOOK.md)." }
$dir = Join-Path $env:LOCALAPPDATA "dev.cloudpc.companion\webview-$Role"
New-Item -Force -ItemType Directory $dir | Out-Null
$env:WEBVIEW2_USER_DATA_FOLDER = $dir
Start-Process -FilePath $exe
Write-Host "Da mo cua so '$Role' (du lieu rieng: $dir)."
