# Từ thư mục dự án đến UniAct chạy trên mạng

Ngày chuẩn bị: 03/11/2026. Đây là lộ trình thực hiện; ứng dụng chưa được khởi tạo và các lệnh dự kiến chưa tồn tại cho đến khi agent tạo chúng.

## 1. Mở đúng thư mục

Trong VS Code, chọn File → Open Folder và mở thư mục dự án UNIHACK mà bạn định dùng xuyên suốt. Thư mục được chuẩn bị trong chat này là:

`C:\Users\ADMIN\OneDrive\เอกสาร\ChatGPT\UNIHACK`

Phải thấy README.md, AGENTS.md, CLAUDE.md và docs/MVP.md. Nếu cửa sổ trong ảnh chỉ có bộ khung cũ, kiểm tra đường dẫn folder: có thể đang mở một bản khác. Lưu công việc hiện tại trước khi đổi folder. Không tạo thêm một bản dự án ở chỗ khác rồi trộn file bằng tay.

## 2. Kiểm tra công cụ trong chính VS Code

Mở Terminal → New Terminal. Chạy riêng từng dòng:

```powershell
node --version
npm.cmd --version
git --version
```

Nếu Node/npm chưa chạy được, tải Windows Installer từ https://nodejs.org/en/download, chọn một bản Node 24 LTS hiện hành cho lộ trình này, cài kèm npm rồi mở lại VS Code. Node 24 là lựa chọn tham chiếu tương thích các yêu cầu hiện tại của Next.js và Hardhat 3; agent cần kiểm tra phiên bản dependencies khi tạo dự án.

`npm.cmd` tránh việc PowerShell chọn script npm.ps1 bị chặn bởi execution policy. Nếu lệnh không tìm thấy, cần xử lý cài đặt/PATH trước khi scaffold app.

Đạt khi cả ba dòng đều trả số phiên bản. Kiểm tra trong môi trường chat thấy Git và Claude Code, có một Node đi kèm Codex, nhưng chưa tìm thấy npm; điều này không thay thế kết quả terminal VS Code của bạn.

## 3. Chuẩn bị agent

Claude Code đã có trong danh sách extension của VS Code. Mở panel Claude Code và đăng nhập nếu được yêu cầu. Chọn một cuộc trò chuyện của dự án làm nơi triển khai chính.

Để dùng Codex: Extensions → tìm Codex của OpenAI, cài theo liên kết chính thức https://developers.openai.com/codex/ide/ rồi đăng nhập. Có thể mở bằng Command Palette → Codex: Open Codex Sidebar.

Đề xuất: Claude Code viết code; Codex đọc và review sau từng mốc. Bạn cũng có thể đảo hai vai trò. Chờ agent viết xong trước khi cho agent còn lại review; chỉ cho một agent sửa cùng checkout tại một thời điểm. Không cần kết nối Claude với Codex bằng MCP để làm theo cách này.

AGENTS.md chứa quy ước chung. CLAUDE.md hướng Claude đọc cùng bộ quy ước. MVP.md mô tả sản phẩm; PROGRESS.md giúp phiên mới hiểu đang làm tới đâu.

## 4. Công nghệ tham chiếu và tài khoản cần có

| Phần | Lựa chọn cho lộ trình |
| --- | --- |
| Giao diện và xử lý máy chủ | Next.js, TypeScript, Tailwind CSS |
| Đăng nhập và dữ liệu dùng chung | Supabase Auth + PostgreSQL, có phân quyền RLS |
| Ví bản đầu | Kết nối Core hoặc MetaMask; tổ chức liên kết ví bằng chữ ký |
| Kết nối blockchain | viem/wagmi theo phiên bản tương thích |
| Smart contract | Solidity, OpenZeppelin, Hardhat 3 |
| Mạng triển khai hợp đồng | Avalanche Fuji |
| Quản lý source | Git + GitHub |
| Triển khai web | Vercel; dữ liệu lưu Supabase |

Chuẩn bị tài khoản GitHub, Supabase, Vercel và ví testnet. DApp hiện không cần API AI; tài khoản dùng coding agent tách biệt với các tài khoản chạy sản phẩm.

Lựa chọn này nhằm đưa dự án Windows tới bản chạy được. SenpAI dùng Next.js + SQLite + Foundry + Docker; UniAct không phải dùng y hệt hạ tầng đó để có chất lượng demo tương đương. Nếu sau này cần tự tạo ví và tài trợ gas như SenpAI, đó là mốc bổ sung riêng.

## 5. Khởi tạo bộ mã nguồn bằng agent

Gửi prompt sau cho agent triển khai:

```text
Đọc AGENTS.md, CLAUDE.md, README.md, docs/MVP.md và docs/PROGRESS.md.
Kiểm tra thư mục hiện tại và các công cụ cài sẵn. Triển khai mốc 1 cho UniAct:
- Next.js + TypeScript + Tailwind trong web/; Hardhat 3 trong contracts/.
- Chuẩn bị supabase/migrations/ và tài liệu cấu hình Supabase Auth + PostgreSQL.
- Dùng Node 24 LTS và các phiên bản dependencies tương thích; đọc tài liệu chính thức khi cần.
- Tạo giao diện tiếng Việt cho khám phá hoạt động, chi tiết, hoạt động của tôi, quản lý tổ chức và tạo bài.
- Dữ liệu giả phải ghi rõ là bản xem giao diện; không giả giao dịch, đăng nhập hay kết quả triển khai.
- Giữ tài liệu hiện có, chuẩn bị .gitignore và .env.example; không ghi secret vào source.
- Tạo các script chạy/build/typecheck cần thiết và hướng dẫn chính xác trong README.
Hoàn thành bộ khung chạy trên máy và kiểm tra build. Chưa triển khai web hay hợp đồng ở mốc này.
Ghi tiến độ, chỉ rõ màn nào đã hoạt động và màn nào còn dùng dữ liệu mẫu.
```

Không chạy create-next-app vào thư mục gốc đã chứa tài liệu; agent tạo ứng dụng con web/ và bảo toàn tài liệu. Nếu có thư mục trùng từ bộ khung cũ, agent kiểm tra rồi tái sử dụng phần phù hợp.

Đạt khi có package.json thật, cài dependencies xong, build được và thấy giao diện ở địa chỉ local do agent in ra. Thường vào web/ và chạy `npm.cmd run dev`, nhưng chỉ dùng khi README/script đã được tạo.

## 6. Đưa source lên GitHub ngay sau mốc đầu

Trong VS Code, mở Source Control. Nếu chưa có Git, dùng Initialize Repository; review Changes và tạo commit đầu tiên. Dùng Publish to GitHub, đặt tên repo `uniact`, chọn quyền truy cập phù hợp. Không khởi tạo Git lần nữa nếu đã có repo.

Trước commit, xác nhận `.env`, `.env.local`, file chứa khóa, node_modules và dữ liệu chạy thử không nằm trong danh sách file đưa lên Git. `.env.example` chỉ chứa tên biến và placeholder thì được đưa lên.

Sau mỗi mốc đã kiểm tra: review thay đổi → commit → push. Cuối cùng repo cần public hoặc cấp quyền cho giám khảo theo yêu cầu BTC. Repo GitHub là source; nó chưa thay cho URL web đã deploy.

## 7. Làm tài khoản, dữ liệu và luồng CTXH thật

Tạo project Supabase. Agent cung cấp migrations và tên biến môi trường; bạn tự nhập giá trị vào `.env.local`, không gửi khóa quản trị vào chat.

Prompt mốc 2:

```text
Tiếp tục UniAct theo docs/MVP.md. Làm Supabase Auth, dữ liệu bền vững và phân quyền RLS.
Có sinh viên và tổ chức được cấp quyền, không cho người dùng tự nâng vai trò.
Làm tạo nháp, xem hoạt động, đăng ký/hủy, danh sách tham gia và xác nhận hoàn thành.
Đăng ký phải kiểm tra số chỗ nguyên tử; không đăng ký trùng; chỉ chủ hoạt động được xác nhận sau khi kết thúc.
CTXH chỉ cộng một lần khi hoàn thành. Chuẩn bị dữ liệu demo và cách tạo hai tài khoản thử mà không commit mật khẩu.
Chưa bật xuất bản thật nếu chưa có bằng chứng blockchain; giữ bài nháp hoặc chế độ mẫu ghi rõ.
Viết và chạy kiểm thử cho các quy tắc nghiệp vụ, cập nhật README và PROGRESS.
```

Đạt khi hai tài khoản thao tác được, dữ liệu còn sau tải lại, thử sửa hoạt động người khác bị từ chối và xác nhận lặp không tăng CTXH. Dùng hoạt động mẫu đã kết thúc để kiểm tra hoàn thành.

## 8. Làm và kiểm thử hợp đồng trước khi deploy

Prompt mốc 3:

```text
Triển khai hợp đồng UACT test token và ActivityRegistry theo MVP.
Quyền tổ chức phải được cấp bởi quản trị hợp đồng. Một hoạt động miễn phí; mỗi bài sau thu 10 UACT.
Mỗi lần xuất bản ràng buộc mã hoạt động duy nhất và hash nội dung, phát event để backend kiểm chứng.
Không có PII trên chain. Không thu phí nếu toàn bộ thao tác xuất bản thất bại.
Viết kiểm thử quyền, phí, bài miễn phí, thiếu tiền, mã trùng và hành vi chuyển token.
Tạo script deploy local/Fuji, export ABI và ghi deployment theo chain. Chạy test local trước.
Chỉ chuẩn bị script Fuji; không đưa private key vào code hoặc log.
```

Đạt khi kiểm thử hợp đồng qua và quy trình local thực hiện được. Hướng dẫn chính xác lệnh deploy dựa trên script đã tồn tại; không dùng lệnh dự đoán từ một phiên bản Hardhat khác.

## 9. Deploy hợp đồng lên Fuji và nối vào web

Fuji C-Chain: chain ID 43113, RPC https://api.avax-test.network/ext/bc/C/rpc. Tạo ví riêng dùng testnet và nhận AVAX thử từ faucet của BTC hoặc Avalanche. Không dùng seed/private key ví chính.

Theo script đã tạo, cấu hình khóa triển khai ở máy hoặc kho secret phù hợp, chạy deploy, lưu địa chỉ UACT và ActivityRegistry trong file deployment công khai (không có khóa). Cấp quyền cho ví tổ chức demo, cấp UACT thử và có đủ AVAX Fuji để tổ chức ký giao dịch.

Prompt mốc 4:

```text
Nối web UniAct với hợp đồng Fuji đã deploy bằng ABI và địa chỉ đúng chain.
Liên kết ví tổ chức bằng thử thách ký có nonce, thời hạn và kiểm tra chữ ký ở server.
Làm approve UACT khi cần, gọi xuất bản và theo dõi receipt thành công.
Backend xác minh contract/event/chain/người đăng/mã bài/hash, không tin tx hash do client gửi là đủ.
Chỉ đánh dấu xuất bản sau kiểm chứng; một tx không mở nhiều bài.
Xử lý hủy ký, thiếu token, sai mạng và tải lại trang; cho đối soát tiếp nếu chain thành công nhưng cập nhật DB bị gián đoạn.
Đăng bài miễn phí cũng cần đi qua ActivityRegistry để hạn mức nhất quán.
Chạy kiểm tra xuyên suốt và ghi rõ giao dịch Fuji thật đã xác minh.
```

Đạt khi có giao dịch thật kiểm tra trên explorer, token bị trừ đúng, bài được công bố đúng và sinh viên đăng ký được. Token UACT và AVAX dùng trả gas là hai loại khác nhau. Chưa có cơ chế trả gas hộ như SenpAI trong mốc này.

## 10. Review bằng agent thứ hai

Đợi agent triển khai dừng sửa file, tạo commit rồi gửi Codex/Claude còn lại:

```text
Đọc AGENTS.md, docs/MVP.md và thay đổi trong mốc vừa hoàn thành.
Chỉ review, chưa sửa file. Kiểm tra phân quyền server/RLS, liên kết ví, xác minh giao dịch,
đăng ký hết chỗ/trùng, xác nhận CTXH lặp và khôi phục khi tải trang.
Nêu lỗi có bằng chứng với file, vị trí và cách tái hiện; phân biệt kiểm thử đã chạy và chưa chạy.
```

Gửi các lỗi có căn cứ lại cho agent triển khai sửa, chạy lại kiểm tra liên quan rồi commit. Không coi câu trả lời “xong” của agent là thay cho thao tác thử bằng hai tài khoản.

## 11. Deploy web

1. Push bản đã kiểm tra lên GitHub.
2. Vercel → Add New Project → import repo UniAct.
3. Chọn Root Directory là web/; để framework nhận diện Next.js, kiểm tra build command khớp README.
4. Nhập biến môi trường theo `.env.example`. Khóa bí mật chỉ để ở cấu hình server, không có tiền tố NEXT_PUBLIC_.
5. Deploy, đọc build log nếu thất bại.
6. Thêm domain deploy vào cấu hình Site URL/redirect cho Supabase Auth và cấu hình origin/domain ứng dụng nếu có.
7. Nếu biến công khai hoặc cấu hình đổi sau build, redeploy bản mới theo hướng dẫn của nền tảng.
8. Mở URL production và kiểm tra lại bằng tài khoản tổ chức/sinh viên. Kiểm tra người chấm có thể mở URL mà không bị chặn bởi bảo vệ deployment ngoài ý muốn.

Ở đây có hai lần deploy độc lập: hợp đồng lên Fuji; web lên Vercel. Supabase giữ tài khoản/dữ liệu. Không dùng file SQLite cục bộ như nơi lưu bền vững trong cấu hình Vercel này.

## 12. Hoàn thiện bài nộp

- README: vấn đề, người dùng, cách chạy, biến môi trường, kiến trúc và phần Avalanche.
- Địa chỉ hai hợp đồng, chain, mã giao dịch demo và hướng dẫn thử.
- Dữ liệu/tài khoản demo và quy trình reset/cấp token phù hợp, không công khai quyền quản trị.
- Video 2–3 phút: đăng bài trả token → sinh viên đăng ký → xác nhận → CTXH cập nhật.
- Slide: vấn đề, sản phẩm, vì sao dùng Avalanche, demo, giới hạn và bước tiếp theo.
- Repo/slide/video mở được theo quyền BTC yêu cầu; hoàn thành Submit trên trang cuộc thi.
- Theo FAQ đã kiểm tra ngày 03/11/2026, hạn là 23:59 ngày 21/11/2026 giờ Việt Nam. Chừa 19–20/11 cho video, slide và kiểm tra; cố gắng nộp sớm trước hạn.

## Tài liệu chính thức tham chiếu

- Codex trong VS Code: https://developers.openai.com/codex/ide/
- AGENTS.md: https://developers.openai.com/codex/guides/agents-md/
- Claude Code trong VS Code: https://code.claude.com/docs/en/vs-code
- CLAUDE.md: https://code.claude.com/docs/en/memory
- Node: https://nodejs.org/en/download
- Next.js: https://nextjs.org/docs/app/getting-started/installation
- Hardhat: https://hardhat.org/docs/getting-started
- Supabase + Next.js: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- Vercel + Next.js: https://vercel.com/docs/frameworks/full-stack/nextjs
- Avalanche networks: https://build.avax.network/docs/primary-network
- Yêu cầu thi: https://team1vn.xyz/#faq-submit
