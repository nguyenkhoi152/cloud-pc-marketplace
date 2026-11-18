<#
.SYNOPSIS
  Liệt kê / gộp / (tuỳ chọn) áp dụng migrations trong supabase/migrations lên MỘT project Supabase DEV.

.DESCRIPTION
  Mặc định CHỈ LIỆT KÊ file theo thứ tự cùng SHA-256 — không kết nối mạng, không ghi gì.
    -Bundle <đường dẫn>   ghi một file SQL gộp (để dán vào SQL Editor); không kết nối mạng.
    -Apply                chạy từng file bằng psql lên database trong biến môi trường SUPABASE_DB_URL.
                          Cần psql trong PATH, và phải gõ đúng tên project để xác nhận. Dừng ngay khi có lỗi.
  Chuỗi kết nối (có mật khẩu) chỉ đọc từ biến môi trường SUPABASE_DB_URL; script không in, không ghi nó ra đâu cả.

.EXAMPLE
  .\scripts\supabase-migrations.ps1
  .\scripts\supabase-migrations.ps1 -Bundle "$env:TEMP\cpm-migrations.sql"
  $env:SUPABASE_DB_URL = Read-Host "DB URL" -MaskInput   # PowerShell 7; ở 5.1 đặt biến trong cửa sổ riêng
  .\scripts\supabase-migrations.ps1 -Apply -ProjectName "ten-project-dev"
#>
[CmdletBinding()]
param(
  [string]$Bundle,
  [switch]$Apply,
  [string]$ProjectName
)
$ErrorActionPreference = "Stop"
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) "supabase/migrations"
$files = Get-ChildItem -Path $dir -Filter "*.sql" | Sort-Object Name
if (-not $files) { throw "Không thấy migration nào trong $dir" }

Write-Host "Migrations (thứ tự áp dụng):"
foreach ($f in $files) {
  $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLower().Substring(0, 16)
  Write-Host ("  {0}  sha256:{1}…  {2} dòng" -f $f.Name, $h, (Get-Content -LiteralPath $f.FullName).Count)
}

if ($Bundle) {
  $out = foreach ($f in $files) { "-- ===== $($f.Name) =====`n" + (Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8) }
  # UTF-8 KHÔNG BOM (BOM đầu file làm hỏng khi dán vào SQL Editor)
  [System.IO.File]::WriteAllText($Bundle, ($out -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Đã ghi file gộp: $Bundle (chưa áp dụng ở đâu cả)."
}

if ($Apply) {
  if (-not $env:SUPABASE_DB_URL) { throw "Chưa đặt biến môi trường SUPABASE_DB_URL." }
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw "Không tìm thấy psql trong PATH. Dùng SQL Editor với -Bundle, hoặc Supabase CLI (xem docs/SUPABASE_DEV_SETUP.md)." }
  if (-not $ProjectName) { throw "Cần -ProjectName để xác nhận bạn đang áp dụng lên đúng project DEV." }
  $answer = Read-Host "Áp dụng $($files.Count) migration lên project '$ProjectName'. Gõ lại đúng tên project để tiếp tục"
  if ($answer -ne $ProjectName) { throw "Tên không khớp, dừng. Chưa có gì được áp dụng." }
  $env:PGCLIENTENCODING = "UTF8"
  foreach ($f in $files) {
    Write-Host "Áp dụng $($f.Name) ..."
    & psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 --single-transaction -q -f $f.FullName
    if ($LASTEXITCODE -ne 0) { throw "Lỗi ở $($f.Name); dừng. Các file sau chưa được chạy. Gửi nguyên văn thông báo lỗi (không kèm chuỗi kết nối)." }
  }
  Write-Host "Xong. Tiếp theo: chạy supabase/verify/post_migration_checks.sql trong SQL Editor."
}
