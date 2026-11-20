/**
 * Trang "Mở bằng app" của liên kết kết nối: https://<tunnel>/api/connect
 *
 * Người tổ chức gửi liên kết https này qua Zalo/Messenger (ứng dụng chat bấm được liên kết https, không bấm được cloudpc://).
 * Bấm vào: trình duyệt mở trang này, trang chuyển tới cloudpc://connect?server=<địa chỉ máy chủ>, Windows mở app Cloud PC Companion,
 * và app HỎI XÁC NHẬN trước khi đổi máy chủ (địa chỉ máy chủ nhận phiên đăng nhập của người dùng, nên không bao giờ tự đổi im lặng).
 *
 * Địa chỉ đưa vào liên kết lấy từ cấu hình của CHÍNH máy chủ (WALLET_DOMAIN, đặt bằng tên tunnel khi bật), không lấy từ header của yêu cầu,
 * và chỉ nhận dạng *.trycloudflare.com (cùng danh sách cho phép với app: desktop/src/api/endpoint.ts). Mọi giá trị khác ⇒ không tạo liên kết.
 */
export const CONNECT_SCHEME = "cloudpc";
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/;

/** Tên miền hợp lệ của máy chủ (chữ thường), hoặc null. */
export function connectHost(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim().toLowerCase();
  return HOST_RE.test(h) ? h : null;
}

/** Liên kết mở app: cloudpc://connect?server=https%3A%2F%2F<host>. */
export function connectDeepLink(host: string): string {
  return `${CONNECT_SCHEME}://connect?server=${encodeURIComponent(`https://${host}`)}`;
}

/** Trang HTML tự chứa (không tài nguyên ngoài). `host` null ⇒ trang giải thích, không có liên kết. */
export function renderConnectPage(host: string | null): string {
  const safe = connectHost(host);
  const style = "body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:0 auto;padding:2rem 1rem;color:#1b1f23}h1{font-size:1.4rem}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;word-break:break-all}.btn{display:inline-block;background:#2457d6;color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:8px;font-weight:600}.muted{color:#5a6570;font-size:.9rem}button{font:inherit;padding:.35rem .7rem}details{margin-top:1.2rem}@media (prefers-color-scheme:dark){body{background:#14181c;color:#e8ecf0}code{background:#232a31}.muted{color:#9aa6b2}}";
  const head = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Kết nối Cloud PC Companion</title><style>${style}</style></head><body>`;
  if (!safe) {
    return `${head}<h1>Kết nối Cloud PC Companion</h1><p>Máy chủ này chưa khai địa chỉ công khai nên không tạo được liên kết mở app. Hãy dùng liên kết <code>https://….trycloudflare.com/api/connect</code> mà người tổ chức gửi cho bạn.</p></body></html>`;
  }
  const link = connectDeepLink(safe);
  const addr = `https://${safe}`;
  return `${head}<h1>Kết nối Cloud PC Companion</h1>
<p>Máy chủ: <code>${safe}</code></p>
<p><a class="btn" id="open" href="${link}">Mở trong Cloud PC Companion</a></p>
<p class="muted">Nếu trình duyệt hỏi "Mở Cloud PC Companion?", hãy chọn <b>Mở</b>. Trong app bạn sẽ được hỏi xác nhận một lần nữa trước khi kết nối. Chỉ đồng ý nếu bạn tin người gửi.</p>
<details><summary>App không tự mở, hoặc bạn chưa cài app?</summary>
<p>Cài app bằng bộ cài người tổ chức gửi, rồi bấm lại nút ở trên. Hoặc dán thủ công địa chỉ này vào <b>Cài đặt → Kết nối máy chủ</b> trong app:</p>
<p><code id="addr">${addr}</code> <button type="button" id="copy">Sao chép</button></p></details>
<script>(function(){var l=${JSON.stringify(link)};setTimeout(function(){location.href=l},400);var b=document.getElementById("copy");if(b)b.onclick=function(){var t=document.getElementById("addr").textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent="Đã chép"},function(){b.textContent="Hãy chép tay"})}})();</script></body></html>`;
}

/** Phản hồi HTTP của GET /api/connect. `publicHost` = biến môi trường WALLET_DOMAIN của máy chủ. */
export function connectPageResponse(publicHost: string | null | undefined): Response {
  return new Response(renderConnectPage(connectHost(publicHost)), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
