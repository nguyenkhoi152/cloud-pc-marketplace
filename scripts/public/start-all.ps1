<#
.SYNOPSIS
  Bat TOAN BO he thong tren CHINH MAY NAY bang mot lenh (khong can VPS): may chu (API + worker + chuoi Fuji testnet) + tunnel cong khai
  + may host trong WSL2 (agent, gateway, tunnel gateway). Cuoi cung in MA KET NOI de gui cho nguoi dung.
.DESCRIPTION
  1) start-demo.ps1 -Chain fuji -Guest wsl -Agent app -Tunnel -NewEnrollment : don dep tien trinh cu, build web ban san xuat, proxy hep chi /api/*,
     tunnel Cloudflare, API, worker, cam ket gio cua host, ma ghi danh moi (thu hoi thiet bi cu).
  2) node scripts\public\start-host.mjs : tunnel gateway, cau hinh agent, ghi danh, chay agent nen, kiem 401.
  Dung tat ca:  powershell -File scripts\vm\stop-demo.ps1 -KeepVm
  LUU Y: dia chi tunnel (trycloudflare.com) DOI moi lan chay lai; nguoi dung phai nhap ma ket noi moi. Giu may bat, khong de ngu.
  Agent da chay boi script nay: KHONG bam "Bat dau nhan thue" trong app (se xung dot cong 18095).
  Can truoc (lam mot lan): C:\cpm-demo\bin\cloudflared.exe (get-cloudflared.ps1), C:\cpm-demo\fuji\server.env, guest WSL2 da co agent + image Selkies.
#>
param([string]$Distro = "Ubuntu-24.04", [int]$MemoryMb = 4096, [int]$Cpus = 2, [switch]$ServerOnly)
# -ServerOnly: CHI bat may chu + tunnel API va cap ma ghi danh moi (vao C:\cpm-demo\enroll-token.txt). Phan HOST do app Companion dam nhan:
#   mo app > Cho thue may > Thiet lap & chay may > Ghi danh thiet bi (dan ma) > Bat dau nhan thue. Dung khi muon dung quy trinh that trong app.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (Get-Process -Name "cloud-pc-companion" -ErrorAction SilentlyContinue) {
  Write-Warning "App Cloud PC Companion dang mo. Khong bam 'Bat dau nhan thue' trong app: agent da chay bang script nay."
}
# Dong goi lai agent tu ma nguon hien tai (vai giay) de start-host.mjs cap nhat agent trong guest neu khac ban dang cai.
# Khong co buoc nay, agent cu (chua biet bao offline khi dung) se chay mai vi start-all khong tu cai lai agent.
Push-Location $repo
try {
  & npm run bundle -w "@cpm/host-agent" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm run bundle -w @cpm/host-agent that bai (ma $LASTEXITCODE)" }
} finally { Pop-Location }
Write-Host "[1/2] May chu + tunnel API (mat khoang 3-5 phut: build web ban san xuat)"
& "$repo\scripts\vm\start-demo.ps1" -Chain fuji -Guest wsl -Agent app -Tunnel -NewEnrollment
if ($ServerOnly) {
  Write-Host "[2/2] Ghi danh san may host trong guest (chi cau hinh + ghi danh, KHONG bat agent)"
  Push-Location $repo
  try {
    & node "scripts\public\start-host.mjs" $Distro $MemoryMb $Cpus --enroll-only
    if ($LASTEXITCODE -ne 0) { throw "start-host.mjs --enroll-only that bai (ma $LASTEXITCODE)" }
  } finally { Pop-Location }
  Write-Host ""
  Write-Host "CHE DO -ServerOnly: guest da ghi danh san. Trong app chi con: dang nhap tai khoan host > Cho thue may > Bat dau nhan thue."
  return
}
Write-Host "[2/2] May host trong WSL2"
Push-Location $repo
try {
  & node "scripts\public\start-host.mjs" $Distro $MemoryMb $Cpus
  if ($LASTEXITCODE -ne 0) { throw "start-host.mjs that bai (ma $LASTEXITCODE)" }
} finally { Pop-Location }
