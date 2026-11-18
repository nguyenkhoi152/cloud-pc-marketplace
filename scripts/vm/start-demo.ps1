<#
.SYNOPSIS
  Bat phan "may chu" cua demo tren may nay va chuan bi guest cho may cho thue:
  chuoi Hardhat CUC BO + deploy (mo phong, KHONG phai Fuji) -> API (cong 3000) -> worker -> guest Linux cua host.
  Vi la VI GIA LAP, du lieu la Supabase dev. Khong tien that, khong mainnet, khong Fuji.
.DESCRIPTION
  -Guest vm   (mac dinh) Dung VM Linux thu (VirtualBox, KHONG GPU) lam guest va ghi tep backend "ssh-dev" cho app Companion.
  -Guest wsl             Khong dung VM. App Companion dung distro WSL2 ban da chon trong app (can WSL da cai san).
  -Agent app  (mac dinh) KHONG chay agent o day. Ban mo app -> Cho thue may -> "Thiet lap & chay may" -> Bat dau nhan thue.
  -Agent script          Chay agent TRONG guest tu dong lenh (scripts\vm\guest.mjs) de kiem khong can mo app. Chi voi -Guest vm.
  -NewEnrollment         Thu hoi thiet bi cu va cap MA GHI DANH moi (ghi vao <DemoDir>\enroll-token.txt, khong in ra).
  Don dep tien trinh cu truoc (stop-demo.ps1 -KeepVm). Khoa dung la khoa Hardhat CONG KHAI (vo gia tri, chi co nghia voi RPC loopback;
  server tu choi khoi dong neu khoa nay di kem RPC tu xa). Khong in mat khau/khoa rieng/ma ghi danh.
  Can co san (chay mot lan): VM cpm-test-host (scripts\vm\new-test-host-vm.ps1), <DemoDir>\state.json va <DemoDir>\known_hosts
  (scripts\vm\session-setup.mts), web\.env.local da dien, host-agent\dist\cpm-host-agent.cjs (npm run bundle -w @cpm/host-agent).
#>
param(
  [ValidateSet("vm", "wsl")][string]$Guest = "vm",
  [ValidateSet("app", "script")][string]$Agent = "app",
  [switch]$SkipVm,
  [switch]$NewEnrollment,
  [ValidateSet("local", "fuji")][string]$Chain = "local",
  [switch]$Tunnel,
  [string]$DemoDir = "C:\cpm-demo"
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$logs = Join-Path $DemoDir "logs"; New-Item -Force -ItemType Directory $logs | Out-Null
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
$key = Join-Path $env:USERPROFILE "VirtualBox VMs\_secrets\cpm-test-host.ed25519"
$kh = Join-Path $DemoDir "known_hosts"
$backendFile = Join-Path $env:APPDATA "dev.cloudpc.companion\host-backend.json"
$tokenFile = Join-Path $DemoDir "enroll-token.txt"
$fujiDir = "C:\cpm-demo\fuji"; $cf = "C:\cpm-demo\bin\cloudflared.exe"
function Step($m) { Write-Host "[$(Get-Date -Format HH:mm:ss)] $m" }
function WaitUntil($what, [scriptblock]$ok, $sec) { $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt $sec) { try { if (& $ok) { return } } catch { } Start-Sleep -Seconds 3 }; throw "Het gio cho: $what" }
function InVm($cmd) { & ssh.exe -i $key -p 2222 -o BatchMode=yes -o ConnectTimeout=15 -o UserKnownHostsFile=$kh -o StrictHostKeyChecking=yes cpm@127.0.0.1 $cmd 2>$null }
# Goi qua cmd /c: PowerShell 5.1 bien stderr cua lenh native thanh loi dung chuong trinh khi ErrorActionPreference = Stop.
function GuestCmd([string[]]$a) { Push-Location $repo; try { $q = ($a | ForEach-Object { "`"$_`"" }) -join ' '; $o = cmd /c "node scripts\vm\guest.mjs $q 2>&1" | Out-String; if ($LASTEXITCODE -ne 0) { throw "guest.mjs $($a[0]) that bai:`n$o" }; return $o } finally { Pop-Location } }
if ($Agent -eq "script" -and $Guest -ne "vm") { throw "-Agent script chi dung voi -Guest vm (guest WSL do app dieu khien)." }
$need = @("$DemoDir\state.json", "$repo\web\.env.local", "$repo\host-agent\dist\cpm-host-agent.cjs")
if ($Guest -eq "vm") { $need += $kh }
foreach ($f in $need) { if (-not (Test-Path $f)) { throw "Thieu $f (xem phan mo ta dau tep)" } }

if ($Chain -eq "fuji" -and -not (Test-Path "$fujiDir\server.env")) { throw "Thieu $fujiDir\server.env: chay node scripts\fuji\fuji.mjs gen / status / deploy (xem docs\TESTER_GUIDE.md)" }
if ($Tunnel -and $Chain -ne "fuji") { throw "-Tunnel chi co y nghia voi -Chain fuji: nguoi o xa khong co chuoi Hardhat cuc bo cua may nay nen khong tra tien duoc." }
if ($Tunnel) {
  $pin = (Get-Content "$repo\scripts\public\cloudflared.json" -Raw | ConvertFrom-Json).windowsAmd64
  if (-not (Test-Path $cf) -or ((Get-FileHash -Algorithm SHA256 -LiteralPath $cf).Hash.ToLowerInvariant() -ne $pin.sha256)) { throw "Thieu cloudflared dung SHA-256 da ghim. Chay: powershell -File scripts\public\get-cloudflared.ps1" }
}
$prod = ($Chain -eq "fuji")
Step "Don dep tien trinh cu"
& "$PSScriptRoot\stop-demo.ps1" -KeepVm | Out-Host

if ($Guest -eq "vm") {
  if (-not $SkipVm) {
    if (-not ((& $vb list runningvms) -match 'cpm-test-host')) { Step "Bat VM (khoi dong ~2-5 phut; neu treo >10 phut thi tat cung roi bat lai)"; & $vb startvm cpm-test-host --type headless | Out-Null }
    # Luu y PowerShell 5.1: dau nhay kep long trong tham so lenh native bi mat; dung nhay don.
    WaitUntil "Docker trong VM" { (InVm "sudo docker info --format '{{.ServerVersion}}'") -match '^\d+\.' } 720
    Step "VM va Docker san sang"
  }
  # Tep backend cho app Companion: guest la VM thu qua SSH (chi de kiem luong; dich cua san pham la WSL2).
  # 10.0.2.2 = may Windows nhin tu trong VM VirtualBox NAT. Gateway lang nghe 0.0.0.0 TRONG VM; chi 127.0.0.1:18095 cua Windows chuyen tiep vao.
  New-Item -Force -ItemType Directory (Split-Path $backendFile) | Out-Null
  $backend = [ordered]@{ kind = "ssh-dev"; target = "cpm@127.0.0.1"; port = 2222; keyFile = $key; knownHostsFile = $kh; agentApiBase = "http://10.0.2.2:3000/api"; gatewayBind = "0.0.0.0"; label = "VM Linux thu (VirtualBox, khong GPU)" }
  [IO.File]::WriteAllText($backendFile, ($backend | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  Step "Da ghi backend guest cho app: $backendFile"
} else {
  # Guest WSL2: app dung distro WSL2 do nguoi dung chon trong app. PHAI xoa tep backend VM thu con sot lai tu lan chay -Guest vm,
  # neu khong app van nap VM thu (khong cho chon distro WSL, va co ket noi toi VM da tat).
  if (Test-Path $backendFile) {
    $oldKind = ""; try { $oldKind = (Get-Content $backendFile -Raw | ConvertFrom-Json).kind } catch { }
    if ($oldKind -eq "ssh-dev") { Remove-Item -Force $backendFile; Step "Da xoa tep backend VM thu con sot lai ($backendFile): app se dung WSL2" }
  }
}

if ($Chain -eq "local") {
Step "Bat chuoi Hardhat cuc bo (chainId 43113) va deploy contract"
Start-Process cmd -ArgumentList '/c', "npx hardhat node --chain-id 43113 --port 8545 > `"$logs\chain.log`" 2>&1" -WorkingDirectory "$repo\contracts" -WindowStyle Hidden
WaitUntil "node Hardhat" { (Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}').result -eq '0xa869' } 90
Push-Location "$repo\contracts"; cmd /c "npx hardhat run scripts/deploy.ts --network localhost > `"$logs\deploy.log`" 2>&1"; Pop-Location
$m = Get-Content "$repo\contracts\deployments\localhost.json" -Raw | ConvertFrom-Json
$escrow = $m.contracts.RentalEscrow.address; $pcp = $m.contracts.PCP.address
Step "Da deploy: escrow $escrow"

# Khoa Hardhat CONG KHAI: #3 = quote signer, #1 = operator (vai tro cua deploy cuc bo). Chi co nghia tren chuoi Hardhat cuc bo.
$chainEnv = [ordered]@{
  RPC_URL = "http://127.0.0.1:8545"; ESCROW_ADDRESS = $escrow; PCP_ADDRESS = $pcp; TREASURY_ADDRESS = $m.roles.treasury
  QUOTE_SIGNER_PRIVATE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
  OPERATOR_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  ESCROW_DEPLOY_BLOCK = "0"; MIN_CONFIRMATIONS = "1"; WALLET_DOMAIN = "localhost:3000"; WALLET_URI = "http://localhost:3000"
  ALLOWED_ORIGINS = "http://tauri.localhost,http://127.0.0.1:5174,http://localhost:5174"; WORKSPACE_DIR = "$DemoDir\workspaces"
  WORKER_PROVIDER = "agent"; AGENT_COMMAND_TIMEOUT_MS = "60000"; AGENT_COMMAND_POLL_MS = "500"
}
New-Item -Force -ItemType Directory "$DemoDir\workspaces" | Out-Null
($chainEnv.GetEnumerator() | ForEach-Object { "export $($_.Key)=$($_.Value)" }) -join "`n" | Set-Content -Encoding ascii "$DemoDir\chain.env.sh"
foreach ($e in $chainEnv.GetEnumerator()) { Set-Item -Path "Env:$($e.Key)" -Value $e.Value }
} else {
  Step "Chuoi Fuji (testnet): nap cau hinh tu $fujiDir\server.env (khong in khoa)"
  $srv = @{}
  foreach ($l in (Get-Content "$fujiDir\server.env")) { if ($l -match '^\s*([A-Z0-9_]+)=(.*)$') { $srv[$Matches[1]] = $Matches[2].Trim() } }
  foreach ($k in 'RPC_URL', 'PUBLIC_RPC_URL', 'CHAIN_ID', 'ESCROW_ADDRESS', 'PCP_ADDRESS', 'TREASURY_ADDRESS', 'ESCROW_DEPLOY_BLOCK', 'QUOTE_SIGNER_PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY', 'FAUCET_PRIVATE_KEY') { if (-not $srv[$k]) { throw "server.env thieu $k" } }
  if ($srv['CHAIN_ID'] -ne '43113') { throw "server.env khong phai Fuji (CHAIN_ID)" }
  $escrow = $srv['ESCROW_ADDRESS']; $pcp = $srv['PCP_ADDRESS']
  # Phan khong bi mat (worker doc them qua worker.env): KHONG chua khoa. Khoa chi nam trong server.env (ngoai repo/OneDrive) va moi truong cua tien trinh node.
  $chainEnv = [ordered]@{ MIN_CONFIRMATIONS = $srv['MIN_CONFIRMATIONS']; ALLOWED_ORIGINS = "http://tauri.localhost,http://127.0.0.1:5174,http://localhost:5174"; WORKSPACE_DIR = "$DemoDir\workspaces"; WORKER_PROVIDER = "agent"; AGENT_COMMAND_TIMEOUT_MS = "60000"; AGENT_COMMAND_POLL_MS = "500"; WALLET_DOMAIN = "localhost:3000"; WALLET_URI = "http://localhost:3000" }
  New-Item -Force -ItemType Directory "$DemoDir\workspaces" | Out-Null
  foreach ($e in $srv.GetEnumerator()) { Set-Item -Path "Env:$($e.Key)" -Value $e.Value }
  foreach ($e in $chainEnv.GetEnumerator()) { Set-Item -Path "Env:$($e.Key)" -Value $e.Value }
}

$workerEnv = "$DemoDir\chain.env.sh"
if ($Chain -eq "fuji") { $workerEnv = "$fujiDir\server.env,$DemoDir\worker.env" }
$publicUrl = $null
if ($Tunnel) {
  Step "Bat proxy hep (chi /api/*, cong 3100) va tunnel Cloudflare (chi ket noi RA, khong mo cong)"
  Start-Process cmd -ArgumentList '/c', "node scripts\public\api-proxy.mjs --listen 3100 --target http://127.0.0.1:3000 > `"$logs\proxy.log`" 2>&1" -WorkingDirectory $repo -WindowStyle Hidden
  Remove-Item -Force "$logs\tunnel.log" -ErrorAction SilentlyContinue
  Start-Process -FilePath $cf -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:3100', '--no-autoupdate' -RedirectStandardError "$logs\tunnel.log" -RedirectStandardOutput "$logs\tunnel.out.log" -WindowStyle Hidden
  # Bo qua api.trycloudflare.com (noi cloudflared xin tunnel; xuat hien trong thong bao loi).
  $urlRe = 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com'
  WaitUntil "tunnel Cloudflare co URL" { (Get-Content "$logs\tunnel.log" -Raw -ErrorAction SilentlyContinue) -match 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' } 90
  if ((Get-Content "$logs\tunnel.log" -Raw) -match $urlRe) { $publicUrl = $Matches[0] } else { throw "Khong doc duoc URL tunnel (xem $logs\tunnel.log)" }
  $h = ([Uri]$publicUrl).Host
  $chainEnv['WALLET_DOMAIN'] = $h; $chainEnv['WALLET_URI'] = $publicUrl
  Set-Item -Path "Env:WALLET_DOMAIN" -Value $h; Set-Item -Path "Env:WALLET_URI" -Value $publicUrl
}
if ($Chain -eq "fuji") { ($chainEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n" | Set-Content -Encoding ascii "$DemoDir\worker.env" }

Step "Bat API (Next, cong 3000)"
if ($prod) {
  Step "Build ban san xuat cua web (lan dau ~1-2 phut; khong dung 'next dev' khi mo ra Internet)"
  Push-Location $repo; cmd /c "npm run build -w web > `"$logs\web-build.log`" 2>&1"; $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { throw "next build that bai (xem $logs\web-build.log)" }
  Start-Process cmd -ArgumentList '/c', "npm run start -w web -- -p 3000 > `"$logs\api.log`" 2>&1" -WorkingDirectory $repo -WindowStyle Hidden
} else {
  Start-Process cmd -ArgumentList '/c', "npm run dev -w web > `"$logs\api.log`" 2>&1" -WorkingDirectory $repo -WindowStyle Hidden
}
WaitUntil "API tren cong 3000" { (Invoke-RestMethod http://127.0.0.1:3000/api/chain-info).escrow -eq $escrow } 120
if ((Get-Content "$logs\api.log" -Raw) -match 'in use') { throw "Next bi day sang cong khac: con tien trinh cu giu cong 3000. Chay stop-demo.ps1 roi thu lai." }

if ($Tunnel) {
  WaitUntil "API qua tunnel tra chain-info" { (Invoke-RestMethod "$publicUrl/api/chain-info").escrow -eq $escrow } 180
  Set-Content -Encoding ascii "$DemoDir\public-api-url.txt" $publicUrl
  Step "Tunnel hoat dong: $publicUrl"
}

Step "Bat worker (WORKER_PROVIDER=agent)"
Start-Process cmd -ArgumentList '/c', "node scripts\vm\run-worker.mjs `"$repo`" `"$workerEnv`" 21600 > `"$logs\worker.log`" 2>&1" -WorkingDirectory $repo -WindowStyle Hidden

Step "Bao dam may demo co cam ket thoi gian con han cua host"
Push-Location $repo; cmd /c "npx tsx scripts\vm\ensure-commitment.mts `"$DemoDir\state.json`" 8"; Pop-Location

$enrolled = $false
if ($Guest -eq "vm") {
  Step "Kiem tra guest (chi doc)"
  $probe = GuestCmd @("probe")
  $enrolled = $probe -match '(?m)^enrolled=1'
  if ($probe -notmatch '(?m)^docker_daemon=1' -or $probe -notmatch '(?m)^image_present=1' -or $probe -notmatch '(?m)^node=1[89]\.|(?m)^node=[2-9]\d\.') {
    Write-Warning "Guest chua du thanh phan (Docker/Node/image). Trong app: Thiet lap & chay may -> Cai thanh phan trong guest; hoac: node scripts\vm\guest.mjs provision"
  }
}
# Guest WSL2: script khong the kiem tra guest da ghi danh chua (WSL do app dieu khien), va tu dong thu hoi thiet bi cu moi lan chay se
# lam mat ghi danh dang dung. Nen CHI cap ma khi nguoi dung yeu cau (-NewEnrollment): lan dau, hoac khi app bao chua ghi danh.
$tokenIssued = $false
if ($NewEnrollment -or ($Guest -eq "vm" -and -not $enrolled)) {
  Step "Cap ma ghi danh moi cho may demo (vai tro admin; thu hoi thiet bi cu)"
  Push-Location $repo; cmd /c "npx tsx scripts\vm\issue-enrollment.mts `"$DemoDir\state.json`" `"$tokenFile`""; $rc = $LASTEXITCODE; Pop-Location
  if ($rc -ne 0) { throw "Khong cap duoc ma ghi danh" }
  $enrolled = $false; $tokenIssued = $true
}

if ($Agent -eq "script") {
  Step "Cai agent vao guest va cau hinh"
  GuestCmd @("install") | Out-Null
  GuestCmd @("configure") | Out-Null
  if (-not $enrolled) { Step "Ghi danh thiet bi trong guest"; GuestCmd @("enroll", $tokenFile) | Out-Null; Remove-Item -Force $tokenFile -ErrorAction SilentlyContinue }
  Step "Bat agent TRONG guest (gateway 18095)"
  Start-Process cmd -ArgumentList '/c', "node scripts\vm\guest.mjs run > `"$logs\agent.log`" 2>&1" -WorkingDirectory $repo -WindowStyle Hidden
  WaitUntil "gateway tra 401 khi khong co token" { try { Invoke-WebRequest http://127.0.0.1:18095/ -UseBasicParsing -ErrorAction Stop | Out-Null; $false } catch { $_.Exception.Response.StatusCode.value__ -eq 401 } } 600
  Step "Agent trong guest da chay"
}

Write-Host ""
if ($publicUrl) {
  Write-Host ""
  Write-Host "MA KET NOI cho nguoi thu (dan vao app: Cai dat > Ket noi may chu): $publicUrl"
  Write-Host "  Doi moi lan chay lai script nay. Giu may bat va script nay chay suot dot thu. Da ghi: $DemoDir\public-api-url.txt"
}
Write-Host "MAY CHU DEMO SAN SANG ($(if ($Chain -eq 'fuji') { 'chuoi Fuji testnet' } else { 'chuoi Hardhat cuc bo' }) + API :3000 + worker). Nhat ky: $logs. Dung tat ca: scripts\vm\stop-demo.ps1"
if ($Agent -eq "app") {
  Write-Host "CHO THUE: mo app 'Cloud PC Companion' (cua so host: scripts\vm\open-app.ps1 -Role host), dang nhap tai khoan host,"
  Write-Host "  Cho thue may -> Thiet lap & chay may -> lam theo cac buoc -> Bat dau nhan thue."
  if ($tokenIssued) { Write-Host "  Ma ghi danh (dung mot lan, het han sau 15 phut) nam trong: $tokenFile  -> dan vao buoc 'Ghi danh thiet bi'; xoa tep sau khi dung." }
  elseif ($Guest -eq "wsl") { Write-Host "  Neu app bao 'chua ghi danh' (lan dau): chay lai voi -NewEnrollment de cap ma moi (se thu hoi thiet bi cu cua may demo)." }
}
Write-Host "THUE: mo app (cua so nguoi thue: scripts\vm\open-app.ps1 -Role renter), dang nhap nguoi thue demo (desktop\.env.smoke.local: DEMO_RENTER_*)."
Write-Host "  Vi -> Lien ket vi (VI GIA LAP) -> Kham pha -> may smoke-* -> Giu may -> Tra tien -> Mo man hinh -> Ket thuc."
