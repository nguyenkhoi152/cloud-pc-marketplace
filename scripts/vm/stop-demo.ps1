<#
.SYNOPSIS
  Dung toan bo dich vu demo (agent trong guest, worker, API, chuoi Hardhat cuc bo, Vite) va tat VM thu.
.DESCRIPTION
  Dung theo dong lenh tien trinh, khong theo ten tep (da bi sot nhieu lan: API cu giu cong 3000 lam quote mang token cu).
  Agent trong guest duoc dung TU TE truoc (cat phien xem, xoa container khach) roi moi dung cac tien trinh tren Windows.
  Khong dong app Companion: neu app dang chay agent, hay bam "Dung nhan thue" trong app hoac dong app.
  -KeepVm: giu VM chay (start-demo.ps1 dung de don dep truoc khi bat lai).
#>
param([switch]$KeepVm)
$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
$backendFile = Join-Path $env:APPDATA "dev.cloudpc.companion\host-backend.json"
$vmUp = (Test-Path $vb) -and ((& $vb list runningvms) -match 'cpm-test-host')
# 1. Agent trong guest (VM thu): dung tu te de agent tu don guest. Chi khi backend la ssh-dev va VM dang chay.
if ($vmUp -and (Test-Path $backendFile) -and ((Get-Content $backendFile -Raw) -match '"ssh-dev"')) {
  Push-Location $repo
  $o = & node scripts\vm\guest.mjs stop 2>&1 | Out-String
  Pop-Location
  if ($o -match 'stop_done=1') { Write-Host "agent trong guest da dung (guest duoc don)" } else { Write-Warning "khong xac nhan duoc viec dung agent trong guest" }
}
# 2. Tien trinh tren Windows.
$pat = 'api-proxy|workerMain|run-worker|host-agent[\\/]src[\\/]main|next[\\/]dist|next dev|hardhat|vite|renter-session|app-session|host-flow|tsx.*main\.ts|scripts[\\/]vm[\\/]guest\.mjs|scripts[\\/]public[\\/]hold-agent\.mjs'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -notmatch 'Get-CimInstance' -and (($_.Name -match '^(node|cmd)\.exe$' -and $_.CommandLine -match $pat) -or ($_.Name -eq 'ssh.exe' -and $_.CommandLine -match 'cpm-guest\.sh run')) }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
# Tunnel Cloudflare do start-demo -Tunnel bat (chi tien trinh cloudflared dat o C:\cpm-demo\bin).
foreach ($c in (Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq 'C:\cpm-demo\bin\cloudflared.exe' })) { Stop-Process -Id $c.Id -Force -ErrorAction SilentlyContinue; Write-Host "da dung tunnel cloudflared pid $($c.Id)" }
Start-Sleep -Seconds 3
foreach ($port in 8545, 3000, 3001, 3100, 5174) {
  foreach ($x in (netstat -ano | Select-String ":$port .*LISTENING")) {
    $id = [int](($x -split '\s+')[-1]); $pr = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($pr -and $pr.ProcessName -eq 'node') { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host "da dung node pid $id (cong $port)" }
  }
}
Start-Sleep -Seconds 2
# Cong 18095 la cong chuyen tiep cua VirtualBox toi gateway trong VM: van "LISTENING" khi VM con chay du agent da dung (binh thuong).
$busy = @(8545, 3000, 3001) | Where-Object { (netstat -ano | Select-String ":$_ .*LISTENING" | Measure-Object).Count -gt 0 }
if ($busy) { Write-Warning "Cong con bi giu: $($busy -join ', ') (tien trinh khong phai node?)" } else { Write-Host "Cac cong 8545/3000/3001 da trong." }
if (-not $KeepVm) {
  if ($vmUp) {
    & $vb controlvm cpm-test-host acpipowerbutton 2>&1 | Out-Null
    $t0 = Get-Date
    do { Start-Sleep -Seconds 5; $running = (& $vb list runningvms) -match 'cpm-test-host' } while ($running -and ((Get-Date) - $t0).TotalSeconds -lt 150)
    if ($running) { & $vb controlvm cpm-test-host poweroff 2>&1 | Out-Null; Write-Host "VM tat cung (ACPI khong kip)" } else { Write-Host "VM da tat sach" }
  } else { Write-Host "VM khong chay" }
}
