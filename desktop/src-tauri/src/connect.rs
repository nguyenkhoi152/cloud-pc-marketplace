//! Liên kết kết nối: `cloudpc://connect?server=<https://tên-miền>`.
//!
//! Người tổ chức gửi liên kết https (trang /api/connect của máy chủ) → trình duyệt mở `cloudpc://connect?...` → Windows mở app (bộ cài đăng ký scheme;
//! bấm khi app đang mở thì plugin single-instance chuyển vào app đang chạy) → lớp này kiểm dạng liên kết rồi đưa địa chỉ cho giao diện.
//! Giao diện LUÔN hỏi xác nhận và kiểm lại danh sách tên miền được phép (desktop/src/api/endpoint.ts) trước khi đổi máy chủ:
//! địa chỉ máy chủ nhận phiên đăng nhập của người dùng, nên không có đường nào đổi im lặng. Ở đây chỉ kiểm DẠNG, không quyết định tin hay không.
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Sự kiện gửi cho giao diện khi có liên kết hợp lệ. Giao diện không tin payload: nó gọi `connect_take_pending` để lấy giá trị (một nguồn duy nhất).
pub const EVENT: &str = "cpm-connect";

#[derive(Default)]
pub struct PendingConnect(Mutex<Option<String>>);

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Giải mã %XX. Trả None nếu %XX hỏng hoặc kết quả không phải UTF-8.
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let (h, l) = (hex(*b.get(i + 1)?)?, hex(*b.get(i + 2)?)?);
            out.push(h * 16 + l);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `https://<host>` hoặc `https://<host>/api` (host chỉ gồm a-z 0-9 . -, có ít nhất một dấu chấm, không cổng/userinfo/query). Trả về `https://<host>`.
fn clean_origin(s: &str) -> Option<String> {
    let s = s.trim().to_ascii_lowercase();
    let host = s.strip_prefix("https://")?;
    let host = host.strip_suffix("/api").or_else(|| host.strip_suffix("/api/")).unwrap_or(host).trim_end_matches('/');
    let ok = (4..=253).contains(&host.len())
        && host.contains('.')
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-'])
        && !host.contains("..")
        && host.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-');
    ok.then(|| format!("https://{host}"))
}

/// Rút địa chỉ máy chủ từ liên kết. Chỉ nhận `cloudpc://connect[/]?server=<https origin>`; mọi thứ khác ⇒ None.
pub fn parse_connect_link(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.len() > 600 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let lower = raw.to_ascii_lowercase();
    let rest = lower.strip_prefix("cloudpc://connect")?;
    let query = rest.strip_prefix("/?").or_else(|| rest.strip_prefix('?'))?;
    // Lấy giá trị từ RAW (không phải bản chữ thường) rồi mới kiểm: vị trí tham số giống nhau vì chỉ đổi chữ hoa/thường ASCII.
    let offset = raw.len() - query.len();
    let query_raw = &raw[offset..];
    let value = query_raw.split('&').find_map(|kv| kv.strip_prefix("server=").or_else(|| kv.strip_prefix("SERVER=")))?;
    clean_origin(&percent_decode(value)?)
}

/// Nhận một liên kết (từ lúc khởi động hoặc từ lần bấm khi app đang mở). Hợp lệ ⇒ lưu chờ giao diện lấy và báo cho giao diện.
pub fn offer(app: &AppHandle, raw: &str) -> bool {
    let Some(server) = parse_connect_link(raw) else { return false };
    *app.state::<PendingConnect>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(server.clone());
    let _ = app.emit(EVENT, server);
    true
}

/// Giao diện lấy (và xoá) địa chỉ đang chờ xác nhận. None nếu không có.
#[tauri::command]
pub fn connect_take_pending(state: tauri::State<'_, PendingConnect>) -> Option<String> {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "https://able-seat-9-fox.trycloudflare.com";

    #[test]
    fn accepts_the_link_forms_the_page_and_windows_produce() {
        for l in [
            "cloudpc://connect?server=https%3A%2F%2Fable-seat-9-fox.trycloudflare.com",
            "cloudpc://connect/?server=https%3A%2F%2Fable-seat-9-fox.trycloudflare.com",
            "cloudpc://connect?server=https://able-seat-9-fox.trycloudflare.com",
            "cloudpc://connect?server=https%3A%2F%2Fable-seat-9-fox.trycloudflare.com%2Fapi",
            "CLOUDPC://CONNECT?server=https%3A%2F%2FABLE-seat-9-fox.trycloudflare.com",
            "cloudpc://connect?x=1&server=https%3A%2F%2Fable-seat-9-fox.trycloudflare.com",
            "  cloudpc://connect?server=https%3a%2f%2fable-seat-9-fox.trycloudflare.com  ",
        ] {
            assert_eq!(parse_connect_link(l).as_deref(), Some(H), "{l}");
        }
    }

    #[test]
    fn rejects_everything_else() {
        for l in [
            "",
            "https://able-seat-9-fox.trycloudflare.com",
            "cloudpc://other?server=https%3A%2F%2Fa.trycloudflare.com",
            "cloudpc://connect",
            "cloudpc://connect?server=",
            "cloudpc://connect?srv=https%3A%2F%2Fa.trycloudflare.com",
            "cloudpc://connect?server=http%3A%2F%2Fa.trycloudflare.com",
            "cloudpc://connect?server=https%3A%2F%2Fuser%3Apw%40a.trycloudflare.com",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com%3A8443",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com%2Fevil",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com%3Fx%3D1",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com%23f",
            "cloudpc://connect?server=https%3A%2F%2F.trycloudflare.com",
            "cloudpc://connect?server=https%3A%2F%2Fa..com",
            "cloudpc://connect?server=https%3A%2F%2Flocalhost",
            "cloudpc://connect?server=https%3A%2F%2Fa b.trycloudflare.com",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com%0Ax",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com%ZZ",
            "cloudpc://connect?server=https%3A%2F%2F%FF.trycloudflare.com",
            "cloudpc://connect?server=javascript%3Aalert(1)",
            "cloudpc://connect?server=https%3A%2F%2Fa.trycloudflare.com&server=https%3A%2F%2Fb.com\nx",
        ] {
            assert_eq!(parse_connect_link(l), None, "{l:?}");
        }
        assert_eq!(parse_connect_link(&format!("cloudpc://connect?server={}", "a".repeat(700))), None);
    }

    #[test]
    fn only_checks_shape_not_trust() {
        // Danh sách tên miền được phép nằm ở giao diện (endpoint.ts), không lặp lại ở đây: một tên miền khác dạng hợp lệ vẫn được chuyển tiếp,
        // và giao diện sẽ từ chối nó (có test riêng bên đó).
        assert_eq!(parse_connect_link("cloudpc://connect?server=https%3A%2F%2Fexample.com").as_deref(), Some("https://example.com"));
    }
}
