<#
.SYNOPSIS
  Build bo cai Windows (NSIS) cua Cloud PC Companion va (tuy chon) cai cho nguoi dung hien tai.
.DESCRIPTION
  -Profile local (mac dinh): DEMO CUC BO. App tro toi may chu API va chuoi Hardhat TREN CHINH MAY NAY (loopback):
      VITE_API_BASE_URL   = http://127.0.0.1:3000/api
      VITE_DEV_WALLET_RPC = http://127.0.0.1:8545   (bat VI GIA LAP; vi tu choi neu RPC khong phai loopback hoac khong phai nut Hardhat)
  -Profile tester: BAN CHO NGUOI THU O MAY KHAC (Fuji testnet qua tunnel). KHONG co dia chi API co dinh (nguoi thu dan "ma ket noi" trong
      Cai dat > Ket noi may chu) va KHONG bat vi gia lap (vi thu Fuji dung RPC do may chu cong bo). Dong goi kem cloudflared (ban GHIM trong
      scripts\public\cloudflared.json, da kiem SHA-256) de may host mo kenh ra Internet. Bo cai chep vao C:\cpm-demo\release\ cung SHA256SUMS.txt.
      Can truoc: C:\cpm-demo\bin\cloudflared.exe dung SHA-256 ghim (chay scripts\public\get-cloudflared.ps1).
  Cac bien VITE_* khac (VITE_APP_MODE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) lay tu desktop\.env.local (chi gia tri cong khai).
  Agent cua host (host-agent\dist\cpm-host-agent.cjs) duoc dong goi lai va NHUNG vao app trong luc build.
  Thu muc build Rust dat ngoai OneDrive, duong dan ASCII: C:\cpm-tauri-target.
  -Install: chay bo cai o che do im lang (/S), cai cho NGUOI DUNG HIEN TAI (%LOCALAPPDATA%\Cloud PC Companion), khong can quyen admin.
  Bo cai CHUA ky so: Windows SmartScreen co the canh bao khi chay tren may khac.
#>
param([ValidateSet("local", "tester")][string]$Profile = "local", [switch]$Install)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
$env:CARGO_TARGET_DIR = "C:\cpm-tauri-target"
if (Get-Process -Name "cloud-pc-companion" -ErrorAction SilentlyContinue) { throw "App dang chay. Dong moi cua so Cloud PC Companion truoc khi build/cai (neu dang cho thue, bam Dung nhan thue truoc)." }
$extra = @()
$sidecar = Join-Path $repo "desktop\src-tauri\bin\cloudflared-x86_64-pc-windows-msvc.exe"
if ($Profile -eq "local") {
  $env:VITE_API_BASE_URL = "http://127.0.0.1:3000/api"
  $env:VITE_DEV_WALLET_RPC = "http://127.0.0.1:8545"
  Remove-Item -Force $sidecar -ErrorAction SilentlyContinue
} else {
  # Ban tester KHONG duoc co dia chi API/vi gia lap nhung san: neu desktop\.env.local dat hai bien nay thi build se nhung chung vao. Chi kiem TEN bien, khong in gia tri.
  $envLocal = Join-Path $repo "desktop\.env.local"
  if ((Test-Path $envLocal) -and (Select-String -Path $envLocal -Pattern '^\s*VITE_(API_BASE_URL|DEV_WALLET_RPC)\s*=' -Quiet)) { throw "desktop\.env.local dang dat VITE_API_BASE_URL hoac VITE_DEV_WALLET_RPC: bo hai bien nay truoc khi build ban tester." }
  Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_DEV_WALLET_RPC -ErrorAction SilentlyContinue
  $pin = (Get-Content (Join-Path $repo "scripts\public\cloudflared.json") -Raw | ConvertFrom-Json).windowsAmd64
  $cf = "C:\cpm-demo\bin\cloudflared.exe"
  if (-not (Test-Path $cf) -or ((Get-FileHash -Algorithm SHA256 -LiteralPath $cf).Hash.ToLowerInvariant() -ne $pin.sha256)) { throw "Thieu cloudflared dung SHA-256 da ghim. Chay: powershell -File scripts\public\get-cloudflared.ps1" }
  New-Item -Force -ItemType Directory (Split-Path $sidecar) | Out-Null
  Copy-Item -Force $cf $sidecar
  $cfg = "C:\cpm-demo\build\tauri.tester.json"
  New-Item -Force -ItemType Directory (Split-Path $cfg) | Out-Null
  '{"bundle":{"externalBin":["bin/cloudflared"]}}' | Set-Content -Encoding ascii $cfg
  $extra = @("--config", $cfg)
}
Push-Location $repo
try {
  cmd /c "npm run tauri -w @cpm/desktop -- build $($extra -join ' ') 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "tauri build that bai (ma $LASTEXITCODE)" }
} finally { Pop-Location }
$setup = Get-ChildItem "C:\cpm-tauri-target\release\bundle\nsis\*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "Khong thay bo cai trong C:\cpm-tauri-target\release\bundle\nsis" }
$sig = (Get-AuthenticodeSignature $setup.FullName).Status
$hash = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash
Write-Host "Bo cai ($Profile): $($setup.FullName) ($([Math]::Round($setup.Length / 1MB, 2)) MiB, chu ky: $sig)"
Write-Host "SHA-256: $hash"
if ($Profile -eq "tester") {
  $rel = "C:\cpm-demo\release"; New-Item -Force -ItemType Directory $rel | Out-Null
  $dest = Join-Path $rel $setup.Name
  Copy-Item -Force $setup.FullName $dest
  "$hash  $($setup.Name)" | Set-Content -Encoding ascii (Join-Path $rel "SHA256SUMS.txt")
  Write-Host "Da chep ra: $dest (+ SHA256SUMS.txt). Gui cho nguoi thu kem docs\TESTER_GUIDE.md."
}
if ($Install) {
  $p = Start-Process -FilePath $setup.FullName -ArgumentList "/S" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Bo cai tra ma $($p.ExitCode)" }
  $exe = Join-Path $env:LOCALAPPDATA "Cloud PC Companion\cloud-pc-companion.exe"
  if (-not (Test-Path $exe)) { throw "Cai xong nhung khong thay $exe" }
  Write-Host "Da cai: $exe ($((Get-Item $exe).LastWriteTime))"
  if ($Profile -eq "tester" -and -not (Test-Path (Join-Path $env:LOCALAPPDATA "Cloud PC Companion\cloudflared.exe"))) { Write-Warning "Khong thay cloudflared.exe canh app sau khi cai: tinh nang mo kenh cho nguoi o mang khac se khong chay." }
}
