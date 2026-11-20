# Hướng dẫn thử Fuji (chưa chạy lần nào)

> **Lưu ý (19/11/2026): đây là tài liệu lịch sử, ghi trạng thái tại ngày 09/11 và 12/11.** Hợp đồng **đã deploy lên Fuji** (17/11) và vòng thuê đã chạy thật trên một máy. Địa chỉ và trạng thái hiện hành: [README mục 2 và 3](../README.md#2-avalanche-fuji-địa-chỉ-và-cách-kiểm-chứng), [PROGRESS](PROGRESS.md).

> **Cập nhật 12/11/2026:** các bước 1–3 bên dưới đã có công cụ: `node scripts/fuji/fuji.mjs gen` (sinh khoá vai trò ở `C:\cpm-demo\fuji\keys.json`, ngoài repo/OneDrive, không in khoá riêng), `status` (chỉ đọc: chainId, số dư, ngân sách ước lượng) và `deploy` (deploy + ghi `deployBlock` + `server.env`). Đã sinh khoá và in địa chỉ cần nạp; **chưa nạp AVAX, chưa deploy**. RPC: ví trong app dùng `api.avax-test.network` (giới hạn 100 khối cho `eth_getLogs`), server dùng publicnode (50.000 khối) — đo ngày 12/11. Quy trình cho đợt thử với người khác: [TESTER_GUIDE](TESTER_GUIDE.md).

Trạng thái 09/11/2026. **Chưa có ví thử, RPC, AVAX Fuji hay contract đã deploy.** Mọi lệnh dưới đây chưa được chạy với dữ liệu thật. Chỉ dùng Fuji testnet (chain 43113), token thử, không mainnet, không tiền thật. Không broadcast gì khi chưa có sự đồng ý của chủ dự án cho bước đó.

## 1. Đầu vào cần chuẩn bị (ở máy bạn, không gửi qua chat)

| Đầu vào | Dùng để | Cách làm |
|---|---|---|
| Ví deployer riêng (chưa từng dùng cho tiền thật) + AVAX Fuji | Trả gas deploy 2 contract + 1 giao dịch cấu hình | Tạo ví mới trong ví của bạn; lấy AVAX từ faucet Fuji chính thức |
| `FUJI_RPC_URL` | Kết nối Fuji | RPC công khai của Avalanche hoặc nhà cung cấp bạn chọn |
| 5 địa chỉ vai trò: operator, arbitrator, quote signer, issuer, treasury | Phân quyền contract | Địa chỉ công khai; operator và quote signer cần **khoá riêng** để server/worker ký (đặt ở môi trường server), các vai trò khác chỉ cần địa chỉ |

## 2. Kiểm tra trước (chỉ đọc)

PowerShell, đặt biến **chỉ trong phiên này** (không lưu vào file Git):

```powershell
$env:FUJI_RPC_URL = "<rpc>"
$env:FUJI_DEPLOYER_PRIVATE_KEY = "<0x...>"
$env:OPERATOR_ADDRESS = "0x..."; $env:ARBITRATOR_ADDRESS = "0x..."; $env:QUOTE_SIGNER_ADDRESS = "0x..."
$env:ISSUER_ADDRESS = "0x..."; $env:TREASURY_ADDRESS = "0x..."
node scripts/fuji-preflight.mjs
```

Script không gửi giao dịch và không in khoá/URL; nó kiểm đủ biến, địa chỉ hợp lệ, RPC trả chainId 43113, số dư AVAX và vai trò là ví thường. Thiếu biến thì thoát mà không kết nối mạng.

## 3. Deploy (cần đồng ý riêng, chưa làm)

```powershell
cd contracts
npx hardhat run scripts/deploy.ts --network fuji
```

`deploy.ts` từ chối nếu thiếu biến vai trò hoặc chainId khác 43113, deploy PCP + RentalEscrow, gọi `configureEscrowOnce`, ghi `contracts/deployments/fuji.json` và xuất ABI. Cấu hình Hardhat đọc `FUJI_RPC_URL` và `FUJI_DEPLOYER_PRIVATE_KEY` bằng `configVariable` (biến môi trường hoặc keystore của Hardhat).

**Rủi ro còn mở:** `evmVersion` mặc định của solc 0.8.28 là `cancun`; việc Fuji chấp nhận bytecode này **chưa kiểm bằng deploy thật**. Nếu deploy lỗi opcode, đổi `evmVersion` trong `contracts/hardhat.config.ts` rồi chạy lại toàn bộ test contract — đừng đổi trước khi có bằng chứng.

## 4. Sau deploy (cũng cần đồng ý riêng)

1. Điền `web/.env.local` theo `web/.env.example`: `RPC_URL`, `ESCROW_ADDRESS`, `PCP_ADDRESS`, `TREASURY_ADDRESS`, `CONFIG_VERSION`, `QUOTE_SIGNER_PRIVATE_KEY` (địa chỉ phải trùng quote signer đã cấu hình trong escrow). `OPERATOR_PRIVATE_KEY` chỉ cho worker, tốt nhất tiến trình riêng.
2. Đặt `ESCROW_DEPLOY_BLOCK` (số block của giao dịch deploy escrow) trong môi trường worker. Địa chỉ contract nằm trong biến môi trường server; bảng `contract_config` chỉ giữ chain/gói/phí/TTL, **không** giữ địa chỉ nên không cần ghi DB cho bước này.
3. Faucet PCP: mỗi ví nhận 1.000 PCP một lần (theo hợp đồng); phải gọi bằng ví người dùng.
4. Thử vòng: giữ máy → quote → fund trên Fuji → worker activate → settle. Mỗi bước ghi tx hash vào báo cáo; không ghi khoá hay URL RPC có token.

## 5. Không làm

Không dùng mainnet; không dùng khoá của người khác; không đặt khoá riêng vào `desktop/.env*` (bị nhúng vào bundle) hay Git; không sweep/rút token ngoài escrow.
