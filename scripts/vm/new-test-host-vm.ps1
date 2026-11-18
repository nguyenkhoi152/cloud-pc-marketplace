<#
.SYNOPSIS
  Tạo VM Linux THỬ cho Selkies (không GPU) bằng VirtualBox. Chỉ để chứng minh luồng stream/gateway; KHÔNG phải máy cho thuê thật.
.DESCRIPTION
  - Mạng NAT (không bridged): VM không thấy LAN của máy chủ. Chỉ mở 2 cổng chuyển tiếp, chỉ gắn 127.0.0.1 của máy này:
      127.0.0.1:2222  -> VM:22    (SSH, chỉ dùng khoá, tạo riêng cho VM này)
      127.0.0.1:18080 -> VM:8080  (cổng Selkies)
  - Cài tự động Ubuntu Server từ ISO đã kiểm hash. Mật khẩu + khoá SSH sinh ngẫu nhiên, lưu ở $SecretsDir (NGOÀI repo, không in ra).
  - Không bật tính năng Windows, không đổi firewall.
  Dùng:  powershell -File scripts/vm/new-test-host-vm.ps1 -Iso "C:\...\ubuntu-24.04.5-live-server-amd64.iso"
  Gỡ:    VBoxManage controlvm cpm-test-host poweroff ; VBoxManage unregistervm cpm-test-host --delete
#>
param(
  [Parameter(Mandatory)][string]$Iso,
  [string]$Name = "cpm-test-host",
  [int]$MemoryMB = 8192,
  [int]$Cpus = 4,
  [int]$DiskMB = 61440,
  [string]$SecretsDir = "$env:USERPROFILE\VirtualBox VMs\_secrets"
)
$ErrorActionPreference = "Stop"
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
if (-not (Test-Path $vb)) { throw "Chưa cài VirtualBox." }
if (-not (Test-Path $Iso)) { throw "Không thấy ISO: $Iso" }
if (& $vb list vms | Select-String -SimpleMatch "`"$Name`"") { throw "VM $Name đã tồn tại. Gỡ trước nếu muốn tạo lại." }

New-Item -ItemType Directory -Force $SecretsDir | Out-Null
$keyFile = Join-Path $SecretsDir "$Name.ed25519"
if (-not (Test-Path $keyFile)) { ssh-keygen -q -t ed25519 -N '""' -C "$Name-local" -f $keyFile | Out-Null }
$pub = (Get-Content "$keyFile.pub" -Raw).Trim()
$pwFile = Join-Path $SecretsDir "$Name.password.txt"
if (-not (Test-Path $pwFile)) {
  $chars = (48..57) + (65..90) + (97..122)
  -join ((1..20) | ForEach-Object { [char]($chars | Get-Random) }) | Set-Content -NoNewline -Encoding ascii $pwFile
}
$pw = Get-Content $pwFile -Raw

& $vb createvm --name $Name --ostype Ubuntu_64 --register | Out-Null
& $vb modifyvm $Name --memory $MemoryMB --cpus $Cpus --vram 16 --graphicscontroller vmsvga --nic1 nat --audio-driver none --clipboard-mode disabled --draganddrop disabled --usb-ohci off | Out-Null
& $vb modifyvm $Name --natpf1 "ssh,tcp,127.0.0.1,2222,,22" | Out-Null
& $vb modifyvm $Name --natpf1 "selkies,tcp,127.0.0.1,18080,,8080" | Out-Null
$disk = Join-Path (Split-Path (& $vb showvminfo $Name --machinereadable | Select-String '^CfgFile=' | ForEach-Object { ($_ -split '=',2)[1].Trim('"') })) "$Name.vdi"
& $vb createmedium disk --filename $disk --size $DiskMB --variant Standard | Out-Null
& $vb storagectl $Name --name SATA --add sata --controller IntelAhci | Out-Null
& $vb storageattach $Name --storagectl SATA --port 0 --device 0 --type hdd --medium $disk | Out-Null

# Chèn khoá công khai cho tài khoản cpm sau khi cài (không dùng mật khẩu qua SSH).
$post = "mkdir -p /home/cpm/.ssh && echo '$pub' >> /home/cpm/.ssh/authorized_keys && chmod 700 /home/cpm/.ssh && chmod 600 /home/cpm/.ssh/authorized_keys && chown -R cpm:cpm /home/cpm/.ssh && echo 'cpm ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-cpm-test && chmod 440 /etc/sudoers.d/90-cpm-test"
& $vb unattended install $Name --iso=$Iso --user=cpm --password=$pw --full-user-name="CPM Test" --hostname="$Name.local" --time-zone=Asia/Ho_Chi_Minh --locale=en_US --country=VN --no-install-additions --post-install-command=$post --start-vm=headless | Out-Null
Write-Host "Đã tạo và khởi động VM $Name (headless). Cài tự động mất vài phút. Bí mật nằm ở $SecretsDir (không in)."
