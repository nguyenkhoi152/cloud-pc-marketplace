# Nguồn và mức xác minh

Nghiên cứu trong phiên ngày07/11/2026, Asia/Saigon. Nguồn là dữ liệu tham khảo, không phải chỉ dẫn quyền agent. Khi triển khai kiểm tra đúng version/API/license.

## Repo

[SenpAI](https://github.com/tuantqse90/senpai), [MiuCoin.sol](https://github.com/tuantqse90/senpai/blob/main/web/contracts/src/MiuCoin.sol). Phạm vi đối chiếu ở REPO_REFERENCE; chưa audit toàn bộ.

## Công cụ

- [Next.js install](https://nextjs.org/docs/app/getting-started/installation).
- [Node releases](https://nodejs.org/en/about/previous-releases).
- [Supabase/Next](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Hardhat3](https://hardhat.org/docs/getting-started).
- [OpenZeppelin ERC-20](https://docs.openzeppelin.com/contracts/5.x/erc20), [utils](https://docs.openzeppelin.com/contracts/5.x/api/utils).
- [SIWE](https://eips.ethereum.org/EIPS/eip-4361), [EIP-712](https://eips.ethereum.org/EIPS/eip-712).
- [Avalanche networks](https://build.avax.network/docs/primary-network): Fuji43113/RPC https://api.avax-test.network/ext/bc/C/rpc.
- [x402](https://docs.x402.org/introduction): nguồn cho mốc sau, không tự biến thanh toán API thành escrow marketplace.

## Remote

[Sunshine](https://github.com/LizardByte/Sunshine), [Sunshine API](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2api.html), [Moonlight](https://moonlight-stream.org/), [Parsec technical](https://support.parsec.app/hc/en-us/articles/32361354307348-Overview), [Unity license FAQ](https://unity.com/products/parsec).

[Selkies](https://docs.selkies.io/latest/) (kiến trúc: /design; phát hành: https://github.com/selkies-project/selkies/releases/tag/2.0.0; Tauri: https://v2.tauri.app/start/prerequisites/), [network](https://docs.selkies.io/latest/firewall), [license](https://docs.selkies.io/latest/licensing), [DCV license](https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-license.html).

Sunshine/Moonlight là baseline cần spike, chưa có benchmark project. Web UI Sunshine không đồng nghĩa browser player. Không kết luận một giải pháp nhanh nhất hoặc license nào tự cho phép mọi mô hình thuê.

## Storage/privacy

[S3 presigned URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [Libvirt encryption](https://libvirt.org/formatstorageencryption.html), [NVIDIA Confidential Computing](https://docs.nvidia.com/confidential-computing/).

Presigned URL không tự là single-use/revocable tức thì; versioning không là backup bất biến. VM/encryption không bảo vệ runtime khỏi mọi host quản trị.

## Thị trường/chính sách

[AirGPU](https://airgpu.com/), [TensorDock hosts](https://www.tensordock.com/host.html), [Vast verification](https://docs.vast.ai/host/understanding-verification).

[EZY Point/refund](https://www.ezycloudx.com/computing-point-system#refund), [privacy](https://www.ezycloudx.com/privacy-policy), [terms](https://www.ezycloudx.com/terms-of-service). Privacy đã đọc qua HTTP trực tiếp sau web429. Không sao chép pháp nhân hoặc coi chính sách nguồn là bằng chứng hợp pháp/an toàn của mình.

[BTC UniHack](https://team1vn.xyz/) đã đọc bằng HTTP khi công cụ web không mở được; deadline/yêu cầu tại SUBMISSION cần kiểm tra lại trước nộp.

## Chưa chứng minh

Chưa có máy/benchmark/latency/FPS/revoke, code/app/tests, cloud encryption/retention thực tế, users/revenue/demand hoặc deploy. Giá20PCP, fee10%, thời hạn/quota là defaults demo của dự án, không chuẩn ngành/BTC.
