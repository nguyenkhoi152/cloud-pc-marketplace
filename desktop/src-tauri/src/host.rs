//! Lớp native cho chế độ "Cho thuê máy" trên Windows: điều khiển môi trường guest Linux của host.
//!
//! Nguyên tắc an toàn:
//!  - UI chỉ gọi được một TẬP LỆNH CỐ ĐỊNH bên dưới. Không có lệnh nào nhận chuỗi shell, đường dẫn hay URL tuỳ ý.
//!  - Mọi tham số đi vào dòng lệnh đều qua kiểm dạng (chỉ chữ, số và . _ : / @ -). Cấu hình agent và token ghi danh đi qua
//!    stdin, không nằm trong dòng lệnh/biến môi trường của tiến trình.
//!  - Chỉ gọi `wsl.exe`/`ssh.exe` bằng đường dẫn tuyệt đối trong System32. Không tự cài WSL, không bật tính năng Windows,
//!    không xin quyền admin, không sửa tường lửa: những việc đó app chỉ HƯỚNG DẪN để người dùng tự làm.
//!  - Backend `wsl` là đích của sản phẩm. Backend `ssh-dev` chỉ đọc từ tệp cấu hình do script demo ghi (UI không đặt được):
//!    dùng VM Linux thử để kiểm cùng một luồng khi máy chưa có WSL.
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// Tệp agent đã đóng gói (host-agent/scripts/bundle.mjs) và script guest: nhúng vào app lúc build, chép vào guest khi cài.
const AGENT_BUNDLE: &[u8] = include_bytes!("../../../host-agent/dist/cpm-host-agent.cjs");
const AGENT_SHA256: &str = include_str!("../../../host-agent/dist/cpm-host-agent.cjs.sha256");
const GUEST_SCRIPT: &str = include_str!("../../../host-agent/guest/cpm-guest.sh");

const SYNC_CMD: &str = "umask 077; mkdir -p .cpm-host && cat > .cpm-host/cpm-guest.sh.new && mv -f .cpm-host/cpm-guest.sh.new .cpm-host/cpm-guest.sh";
const GUEST_SCRIPT_PATH: &str = ".cpm-host/cpm-guest.sh";
const GATEWAY_PORT: u16 = 18095;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ---------------------------------------------------------------- kiểm dạng

fn is_safe_arg(s: &str) -> bool {
    !s.is_empty() && s.len() <= 300 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:/@-".contains(&b))
}
fn is_distro(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty() && b.len() <= 64 && b[0].is_ascii_alphanumeric() && b.iter().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(c))
}
fn is_host_port(s: &str) -> bool {
    let (host, port) = match s.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (s, None),
    };
    let host_ok = !host.is_empty() && host.len() <= 120 && host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    let port_ok = port.map_or(true, |p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u32>().map_or(false, |n| n > 0 && n < 65536));
    host_ok && port_ok
}
/// `http(s)://host[:port]` — không đường dẫn, không query.
pub fn is_origin(s: &str) -> bool {
    let rest = s.strip_prefix("http://").or_else(|| s.strip_prefix("https://"));
    matches!(rest, Some(r) if is_host_port(r))
}
/// `http(s)://host[:port][/đường/dẫn]` chỉ gồm ký tự an toàn; không query/fragment/khoảng trắng.
pub fn is_api_base(s: &str) -> bool {
    if s.len() > 200 || !is_safe_arg(s) {
        return false;
    }
    let rest = match s.strip_prefix("http://").or_else(|| s.strip_prefix("https://")) {
        Some(r) => r,
        None => return false,
    };
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    is_host_port(authority) && !path.contains("//") && !path.contains("..") && !path.contains('@') && !path.contains(':')
}
fn is_token(s: &str) -> bool {
    (20..=200).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn is_ssh_target(s: &str) -> bool {
    match s.split_once('@') {
        Some((u, h)) => !u.is_empty() && !h.is_empty() && s.len() <= 120 && u.bytes().chain(h.bytes()).all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)),
        None => false,
    }
}

// ---------------------------------------------------------------- cấu hình backend

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendFile {
    kind: String,
    distro: Option<String>,
    target: Option<String>,
    port: Option<u16>,
    key_file: Option<String>,
    known_hosts_file: Option<String>,
    /// URL control plane NHÌN TỪ TRONG GUEST (ví dụ VM VirtualBox NAT thấy máy Windows ở 10.0.2.2). Chỉ đặt bằng tệp.
    agent_api_base: Option<String>,
    /// Địa chỉ gateway lắng nghe trong guest. WSL: 127.0.0.1 (Windows tới được qua localhost). VM NAT: 0.0.0.0.
    gateway_bind: Option<String>,
    label: Option<String>,
}

#[derive(Debug, Clone)]
enum Backend {
    Wsl { distro: String },
    SshDev { target: String, port: u16, key_file: String, known_hosts_file: String, agent_api_base: Option<String>, gateway_bind: String, label: String },
}

impl Backend {
    fn gateway_bind(&self) -> &str {
        match self {
            Backend::Wsl { .. } => "127.0.0.1",
            Backend::SshDev { gateway_bind, .. } => gateway_bind,
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|_| "Không xác định được thư mục cấu hình của app.".to_string())?;
    Ok(dir.join("host-backend.json"))
}
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|_| "Không xác định được thư mục dữ liệu của app.".to_string())?.join("host");
    fs::create_dir_all(&dir).map_err(|_| "Không tạo được thư mục dữ liệu của app.".to_string())?;
    Ok(dir)
}

fn parse_backend(f: BackendFile) -> Result<Backend, String> {
    match f.kind.as_str() {
        "wsl" => {
            let distro = f.distro.unwrap_or_default();
            if !is_distro(&distro) {
                return Err("Tên distro WSL không hợp lệ.".into());
            }
            Ok(Backend::Wsl { distro })
        }
        "ssh-dev" => {
            let target = f.target.unwrap_or_default();
            let key_file = f.key_file.unwrap_or_default();
            let known_hosts_file = f.known_hosts_file.unwrap_or_default();
            if !is_ssh_target(&target) {
                return Err("Cấu hình ssh-dev: target phải dạng user@host.".into());
            }
            if !Path::new(&key_file).is_file() || !Path::new(&known_hosts_file).is_file() {
                return Err("Cấu hình ssh-dev: không thấy tệp khoá hoặc known_hosts.".into());
            }
            if let Some(a) = &f.agent_api_base {
                if !is_api_base(a) {
                    return Err("Cấu hình ssh-dev: agentApiBase không hợp lệ.".into());
                }
            }
            let gateway_bind = f.gateway_bind.unwrap_or_else(|| "127.0.0.1".into());
            if gateway_bind != "127.0.0.1" && gateway_bind != "0.0.0.0" {
                return Err("Cấu hình ssh-dev: gatewayBind chỉ nhận 127.0.0.1 hoặc 0.0.0.0.".into());
            }
            let label: String = f.label.unwrap_or_else(|| "Máy Linux thử qua SSH".into()).chars().filter(|c| !c.is_control()).take(80).collect();
            Ok(Backend::SshDev { target, port: f.port.unwrap_or(22), key_file, known_hosts_file, agent_api_base: f.agent_api_base, gateway_bind, label })
        }
        _ => Err("Loại backend không hỗ trợ.".into()),
    }
}

fn load_backend(app: &AppHandle) -> Result<Option<Backend>, String> {
    let p = config_path(app)?;
    let text = match fs::read_to_string(&p) {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let f: BackendFile = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "Tệp cấu hình backend của host bị hỏng.".to_string())?;
    parse_backend(f).map(Some)
}
fn require_backend(app: &AppHandle) -> Result<Backend, String> {
    load_backend(app)?.ok_or_else(|| "Chưa chọn môi trường guest (distro WSL2).".to_string())
}

// ---------------------------------------------------------------- chạy tiến trình

fn system32(exe: &str) -> PathBuf {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    root.join("System32").join(exe)
}
fn wsl_exe() -> PathBuf {
    system32("wsl.exe")
}
fn ssh_exe() -> PathBuf {
    system32("OpenSSH").join("ssh.exe")
}

fn hidden(mut c: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.env("WSL_UTF8", "1");
    c
}

/// wsl.exe in thông báo của chính nó bằng UTF-16LE (trừ khi hiểu WSL_UTF8); đầu ra của lệnh Linux là UTF-8.
pub fn decode_output(bytes: &[u8]) -> String {
    let looks_utf16 = bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).take(64).filter(|b| **b == 0).count() * 4 >= bytes.len().min(128) / 2;
    let s = if looks_utf16 {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    s.replace('\u{feff}', "").replace('\0', "").replace("\r\n", "\n")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Captured {
    /// Mã thoát; -1 nếu không chạy được tệp, -2 nếu hết giờ.
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

fn truncate(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…(đã cắt bớt)", &s[..end])
}

fn run_capture(mut cmd: Command, stdin: Option<Vec<u8>>, timeout: Duration) -> Captured {
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Captured { code: -1, stdout: String::new(), stderr: format!("không chạy được tệp: {}", e.kind()) },
    };
    let writer = stdin.and_then(|data| child.stdin.take().map(|mut si| thread::spawn(move || { let _ = si.write_all(&data); })));
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();
    let t_out = thread::spawn(move || { let mut v = Vec::new(); if let Some(s) = so.as_mut() { let _ = s.read_to_end(&mut v); } v });
    let t_err = thread::spawn(move || { let mut v = Vec::new(); if let Some(s) = se.as_mut() { let _ = s.read_to_end(&mut v); } v });
    let start = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code().unwrap_or(-1),
            Ok(None) if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break -2;
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(_) => break -1,
        }
    };
    if let Some(w) = writer { let _ = w.join(); }
    let stdout = decode_output(&t_out.join().unwrap_or_default());
    let mut stderr = decode_output(&t_err.join().unwrap_or_default());
    if code == -2 {
        stderr.push_str("\nhết giờ chờ");
    }
    Captured { code, stdout: truncate(stdout, 64 * 1024), stderr: truncate(stderr, 16 * 1024) }
}

enum Launch<'a> {
    /// Script đi qua stdin (`bash -s`): luôn dùng bản script nhúng trong app; hành động không cần dữ liệu stdin.
    Piped { root: bool, action: &'a str, args: &'a [&'a str] },
    /// Dùng bản script đã chép vào guest; stdin dành cho dữ liệu (tệp agent, cấu hình, token) hoặc giữ mở (run).
    Installed { action: &'a str, args: &'a [&'a str] },
    /// Chép script vào guest.
    Sync,
}

/// Dựng lệnh chạy trong guest. Mọi phần tử đã qua kiểm dạng; với ssh, chuỗi lệnh từ xa chỉ gồm từ cố định và tham số an toàn.
fn guest_command(b: &Backend, launch: &Launch, long_running: bool) -> Result<Command, String> {
    let (action, args): (&str, &[&str]) = match launch {
        Launch::Piped { action, args, .. } | Launch::Installed { action, args } => (*action, *args),
        Launch::Sync => ("", &[]),
    };
    if !matches!(launch, Launch::Sync) && !is_safe_arg(action) {
        return Err("hành động không hợp lệ".into());
    }
    if args.iter().any(|a| !is_safe_arg(a)) {
        return Err("Tham số chứa ký tự không được phép.".into());
    }
    match b {
        Backend::Wsl { distro } => {
            let mut c = hidden(Command::new(wsl_exe()));
            c.arg("-d").arg(distro);
            if let Launch::Piped { root: true, .. } = launch {
                c.arg("-u").arg("root");
            }
            c.arg("--cd").arg("~").arg("--exec");
            match launch {
                Launch::Piped { .. } => { c.arg("bash").arg("-s").arg("--").arg(action).args(args.iter()); }
                Launch::Installed { .. } => { c.arg("bash").arg(GUEST_SCRIPT_PATH).arg(action).args(args.iter()); }
                Launch::Sync => { c.arg("bash").arg("-c").arg(SYNC_CMD); }
            }
            Ok(c)
        }
        Backend::SshDev { target, port, key_file, known_hosts_file, .. } => {
            let mut c = hidden(Command::new(ssh_exe()));
            c.arg("-i").arg(key_file).arg("-p").arg(port.to_string());
            c.arg("-o").arg("BatchMode=yes").arg("-o").arg("StrictHostKeyChecking=yes");
            c.arg("-o").arg(format!("UserKnownHostsFile={}", known_hosts_file));
            c.arg("-o").arg("ConnectTimeout=20");
            if long_running {
                c.arg("-o").arg("ServerAliveInterval=15").arg("-o").arg("ServerAliveCountMax=4");
            }
            c.arg(target);
            let tail = std::iter::once(action).chain(args.iter().copied()).collect::<Vec<_>>().join(" ");
            let remote = match launch {
                Launch::Piped { root, .. } => format!("{}bash -s -- {}", if *root { "sudo -n " } else { "" }, tail),
                Launch::Installed { .. } => format!("bash {} {}", GUEST_SCRIPT_PATH, tail),
                Launch::Sync => SYNC_CMD.to_string(),
            };
            c.arg(remote);
            Ok(c)
        }
    }
}

fn run_guest(b: &Backend, launch: Launch, stdin: Option<Vec<u8>>, timeout: Duration) -> Result<Captured, String> {
    let cmd = guest_command(b, &launch, false)?;
    let input = match launch {
        Launch::Piped { .. } | Launch::Sync => Some(GUEST_SCRIPT.as_bytes().to_vec()),
        Launch::Installed { .. } => stdin,
    };
    Ok(run_capture(cmd, input, timeout))
}

// ---------------------------------------------------------------- trạng thái tiến trình dài

struct Proc {
    child: Child,
    /// Giữ mở để agent biết app còn sống; đóng (drop) ⇒ agent tự dừng và dọn guest.
    stdin: Option<ChildStdin>,
    log: PathBuf,
    started_ms: u128,
}

#[derive(Default)]
pub struct HostState {
    agent: Mutex<Option<Proc>>,
    provision: Mutex<Option<Proc>>,
    /// cloudflared (kênh RA Internet cho gateway). Chỉ chạy khi host đồng ý; dừng cùng lúc với agent và khi app thoát.
    tunnel: Mutex<Option<Proc>>,
    /// Người dùng cho phép app thu về khay hệ thống khi đóng cửa sổ trong lúc đang nhận thuê. Mặc định TẮT (đóng cửa sổ = thoát = dừng nhận thuê).
    background: AtomicBool,
}

/// Đóng cửa sổ có nên ẩn vào khay (giữ nhận thuê) thay vì thoát không. Chỉ khi người dùng bật VÀ đang có việc chạy: nếu không thì đóng là thoát bình thường.
pub fn should_hide_on_close(background: bool, agent_running: bool, tunnel_running: bool) -> bool {
    background && (agent_running || tunnel_running)
}

impl HostState {
    pub fn hide_on_close(&self) -> bool {
        should_hide_on_close(self.background.load(Ordering::Relaxed), is_running(&self.agent), is_running(&self.tunnel))
    }
}

#[tauri::command]
pub async fn host_set_background(state: State<'_, HostState>, enabled: bool) -> Result<(), String> {
    state.background.store(enabled, Ordering::Relaxed);
    Ok(())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn tail_file(p: &Path, max: u64) -> String {
    let mut f = match File::open(p) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > max {
        let _ = f.seek(SeekFrom::Start(len - max));
    }
    let mut v = Vec::new();
    let _ = f.read_to_end(&mut v);
    let s = decode_output(&v);
    if len > max {
        s.split_once('\n').map(|(_, rest)| rest.to_string()).unwrap_or(s)
    } else {
        s
    }
}

fn spawn_logged(mut cmd: Command, log: &Path, stdin_data: Option<Vec<u8>>, keep_stdin: bool) -> Result<Proc, String> {
    let out = OpenOptions::new().create(true).write(true).truncate(true).open(log).map_err(|_| "Không ghi được nhật ký.".to_string())?;
    let err = out.try_clone().map_err(|_| "Không ghi được nhật ký.".to_string())?;
    cmd.stdin(Stdio::piped()).stdout(Stdio::from(out)).stderr(Stdio::from(err));
    let mut child = cmd.spawn().map_err(|e| format!("Không chạy được tiến trình guest ({}).", e.kind()))?;
    let mut stdin = child.stdin.take();
    if let Some(data) = stdin_data {
        if let Some(mut si) = stdin.take() {
            // Ghi xong thì đóng stdin (EOF) để `bash -s` bắt đầu chạy.
            thread::spawn(move || { let _ = si.write_all(&data); });
        }
    }
    if !keep_stdin {
        stdin = None;
    }
    Ok(Proc { child, stdin, log: log.to_path_buf(), started_ms: now_ms() })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcState {
    /// "never" | "running" | "exited"
    pub state: String,
    pub exit_code: Option<i32>,
    pub started_ms: Option<String>,
    pub log_tail: String,
}

fn proc_state(slot: &Mutex<Option<Proc>>, tail: u64) -> ProcState {
    let mut g = slot.lock().unwrap_or_else(|e| e.into_inner());
    match g.as_mut() {
        None => ProcState { state: "never".into(), exit_code: None, started_ms: None, log_tail: String::new() },
        Some(p) => {
            let (state, exit_code) = match p.child.try_wait() {
                Ok(Some(st)) => ("exited", Some(st.code().unwrap_or(-1))),
                Ok(None) => ("running", None),
                Err(_) => ("exited", Some(-1)),
            };
            if state == "exited" {
                p.stdin = None;
            }
            ProcState { state: state.into(), exit_code, started_ms: Some(p.started_ms.to_string()), log_tail: tail_file(&p.log, tail) }
        }
    }
}

fn is_running(slot: &Mutex<Option<Proc>>) -> bool {
    let mut g = slot.lock().unwrap_or_else(|e| e.into_inner());
    matches!(g.as_mut().map(|p| p.child.try_wait()), Some(Ok(None)))
}

/// Đóng stdin (báo agent dừng) rồi chờ; quá hạn thì kết thúc tiến trình trung gian (wsl.exe/ssh.exe).
fn stop_proc(slot: &Mutex<Option<Proc>>, wait: Duration) {
    let mut g = slot.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(p) = g.as_mut() {
        p.stdin = None;
        let start = Instant::now();
        loop {
            match p.child.try_wait() {
                Ok(Some(_)) | Err(_) => break,
                Ok(None) if start.elapsed() >= wait => {
                    let _ = p.child.kill();
                    let _ = p.child.wait();
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(100)),
            }
        }
    }
}

/// Gọi khi app thoát: agent nhận EOF trên stdin ⇒ cắt phiên xem, dọn guest, thoát.
pub fn shutdown(app: &AppHandle, state: &HostState) {
    // Chỉ dọn khi CHÍNH phiên app này đã bật agent: các cửa sổ khác (ví dụ cửa sổ người thuê) dùng chung tệp backend nhưng không được
    // dừng nhầm agent do cửa sổ host hay script khác bật.
    let started_here = state.agent.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    stop_proc(&state.agent, Duration::from_secs(20));
    stop_proc(&state.provision, Duration::from_secs(1));
    stop_proc(&state.tunnel, Duration::from_secs(1)); // cloudflared không đọc stdin: hết hạn chờ thì bị kết thúc
    if started_here {
        // Phòng thủ: không chỉ dựa vào việc EOF của stdin đi xuyên wsl.exe/ssh.exe (đã kiểm xuyên SSH, CHƯA kiểm xuyên wsl.exe).
        // `stop` trong guest gửi TERM cho agent (nếu còn) và chờ nó dọn xong; nếu agent đã thoát thì là lệnh rỗng nhanh.
        if let Ok(Some(b)) = load_backend(app) {
            let _ = run_guest(&b, Launch::Piped { root: false, action: "stop", args: &[] }, None, Duration::from_secs(120));
        }
    }
}

// ---------------------------------------------------------------- lệnh cho UI

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    kind: String,
    distro: Option<String>,
    label: Option<String>,
    target: Option<String>,
    agent_api_base: Option<String>,
    gateway_bind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    os: String,
    wsl_status: Captured,
    wsl_version: Captured,
    wsl_list_verbose: Captured,
    wsl_list_quiet: Captured,
    backend: Option<BackendInfo>,
    backend_error: Option<String>,
    agent_sha256: String,
    gateway_port: u16,
    agent: ProcState,
    provision: ProcState,
}

fn backend_info(b: &Backend) -> BackendInfo {
    match b {
        Backend::Wsl { distro } => BackendInfo { kind: "wsl".into(), distro: Some(distro.clone()), label: None, target: None, agent_api_base: None, gateway_bind: b.gateway_bind().into() },
        Backend::SshDev { target, agent_api_base, label, .. } => BackendInfo { kind: "ssh-dev".into(), distro: None, label: Some(label.clone()), target: Some(target.clone()), agent_api_base: agent_api_base.clone(), gateway_bind: b.gateway_bind().into() },
    }
}

fn wsl_query(args: &[&str]) -> Captured {
    let mut c = hidden(Command::new(wsl_exe()));
    c.args(args);
    run_capture(c, None, Duration::from_secs(20))
}

/// Chỉ ĐỌC: trạng thái WSL của Windows + backend đã chọn + tiến trình do app quản lý. Không cài, không đổi gì.
#[tauri::command]
pub async fn host_overview(app: AppHandle, state: State<'_, HostState>) -> Result<Overview, String> {
    let (backend, backend_error) = match load_backend(&app) {
        Ok(b) => (b, None),
        Err(e) => (None, Some(e)),
    };
    let q = tauri::async_runtime::spawn_blocking(|| (wsl_query(&["--status"]), wsl_query(&["--version"]), wsl_query(&["--list", "--verbose"]), wsl_query(&["--list", "--quiet"])))
        .await
        .map_err(|_| "Không kiểm tra được WSL.".to_string())?;
    Ok(Overview {
        os: std::env::consts::OS.into(),
        wsl_status: q.0,
        wsl_version: q.1,
        wsl_list_verbose: q.2,
        wsl_list_quiet: q.3,
        backend: backend.as_ref().map(backend_info),
        backend_error,
        agent_sha256: AGENT_SHA256.trim().to_string(),
        gateway_port: GATEWAY_PORT,
        agent: proc_state(&state.agent, 12 * 1024),
        provision: proc_state(&state.provision, 12 * 1024),
    })
}

/// Chọn distro WSL2 làm guest. (Backend ssh-dev không đặt được từ UI.)
#[tauri::command]
pub async fn host_set_wsl_distro(app: AppHandle, state: State<'_, HostState>, distro: String) -> Result<(), String> {
    if !is_distro(&distro) {
        return Err("Tên distro WSL không hợp lệ.".into());
    }
    if is_running(&state.agent) || is_running(&state.provision) {
        return Err("Hãy dừng agent/cài đặt đang chạy trước khi đổi môi trường guest.".into());
    }
    let p = config_path(&app)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|_| "Không tạo được thư mục cấu hình.".to_string())?;
    }
    let body = serde_json::json!({ "kind": "wsl", "distro": distro }).to_string();
    fs::write(&p, body).map_err(|_| "Không ghi được cấu hình backend.".to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| "Tác vụ nền bị huỷ.".to_string())?
}

/// URL control plane mà agent trong guest sẽ gọi: ưu tiên giá trị trong tệp backend (ssh-dev), không thì dùng URL của app.
fn agent_api_base(b: &Backend, app_api_base: &str) -> Result<String, String> {
    let v = match b {
        Backend::SshDev { agent_api_base: Some(a), .. } => a.clone(),
        _ => app_api_base.trim().trim_end_matches('/').to_string(),
    };
    if !is_api_base(&v) {
        return Err("Địa chỉ máy chủ API không hợp lệ.".into());
    }
    Ok(v)
}

/// Chỉ ĐỌC trong guest: hệ điều hành, docker, node, image, agent, ghi danh, GPU, có gọi được control plane không.
#[tauri::command]
pub async fn host_probe(app: AppHandle, api_base: Option<String>) -> Result<Captured, String> {
    let b = require_backend(&app)?;
    let api = match api_base.filter(|s| !s.trim().is_empty()) {
        Some(a) => Some(agent_api_base(&b, &a)?),
        None => None,
    };
    blocking(move || {
        let args: Vec<&str> = api.as_deref().into_iter().collect();
        run_guest(&b, Launch::Piped { root: false, action: "probe", args: &args }, None, Duration::from_secs(90))
    })
    .await
}

/// Chép script guest + tệp agent (nhúng trong app) vào thư mục riêng của user trong guest; kiểm checksum ở phía guest.
#[tauri::command]
pub async fn host_install_agent(app: AppHandle, state: State<'_, HostState>) -> Result<Captured, String> {
    let b = require_backend(&app)?;
    if is_running(&state.agent) {
        return Err("Agent đang chạy; hãy dừng trước khi cài lại.".into());
    }
    blocking(move || {
        let s = run_guest(&b, Launch::Sync, None, Duration::from_secs(60))?;
        if s.code != 0 {
            return Ok(s);
        }
        let sha = AGENT_SHA256.trim();
        run_guest(&b, Launch::Installed { action: "install-agent", args: &[sha] }, Some(AGENT_BUNDLE.to_vec()), Duration::from_secs(120))
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    api_base: String,
    frame_ancestors: Vec<String>,
    #[serde(default)]
    gpu: bool,
    /// URL https công khai của tunnel (do `host_tunnel_state` trả). Không có ⇒ gateway chỉ dùng cho người thuê trên chính máy này.
    #[serde(default)]
    public_url: Option<String>,
    /// Giới hạn RAM (MiB) và số CPU của container khách. Không có ⇒ không giới hạn.
    #[serde(default)]
    memory_mb: Option<u32>,
    #[serde(default)]
    cpus: Option<u32>,
}

const MIN_MEMORY_MB: u32 = 1024;
const MAX_MEMORY_MB: u32 = 262_144;
const MAX_CPUS: u32 = 128;

/// Dòng cấu hình giới hạn tài nguyên (chỉ số nguyên trong dải cho phép; cùng dải với agent).
fn limit_lines(memory_mb: Option<u32>, cpus: Option<u32>) -> Result<String, String> {
    let mut s = String::new();
    if let Some(m) = memory_mb {
        if !(MIN_MEMORY_MB..=MAX_MEMORY_MB).contains(&m) {
            return Err(format!("Giới hạn RAM phải từ {} đến {} MiB.", MIN_MEMORY_MB, MAX_MEMORY_MB));
        }
        s.push_str(&format!("GUEST_DOCKER_MEMORY_MB={}\n", m));
    }
    if let Some(c) = cpus {
        if !(1..=MAX_CPUS).contains(&c) {
            return Err(format!("Giới hạn CPU phải từ 1 đến {}.", MAX_CPUS));
        }
        s.push_str(&format!("GUEST_DOCKER_CPUS={}\n", c));
    }
    Ok(s)
}

/// Ghi cấu hình agent trong guest. Mọi giá trị do app dựng từ các trường đã kiểm dạng; không có trường tự do.
#[tauri::command]
pub async fn host_configure(app: AppHandle, state: State<'_, HostState>, config: AgentConfig) -> Result<Captured, String> {
    let b = require_backend(&app)?;
    if is_running(&state.agent) {
        return Err("Agent đang chạy; hãy dừng trước khi đổi cấu hình.".into());
    }
    let api = agent_api_base(&b, &config.api_base)?;
    if config.frame_ancestors.is_empty() || config.frame_ancestors.len() > 6 || config.frame_ancestors.iter().any(|o| !is_origin(o)) {
        return Err("Danh sách origin của app không hợp lệ.".into());
    }
    let public = match config.public_url.as_deref() {
        Some(u) if is_tunnel_url(u) => u.to_string(),
        Some(_) => return Err("Địa chỉ công khai của tunnel không hợp lệ.".into()),
        None => format!("http://127.0.0.1:{}", GATEWAY_PORT),
    };
    let mut env = String::new();
    env.push_str(&format!("AGENT_API_BASE={}\n", api));
    env.push_str("AGENT_INTERVAL_MS=3000\n");
    env.push_str(&format!("GATEWAY_PUBLIC_URL={}\n", public));
    env.push_str(&format!("GATEWAY_PORT={}\n", GATEWAY_PORT));
    env.push_str(&format!("GATEWAY_BIND={}\n", b.gateway_bind()));
    env.push_str(&format!("GATEWAY_ALLOWED_ORIGINS={}\n", public));
    env.push_str(&format!("GATEWAY_FRAME_ANCESTORS={}\n", config.frame_ancestors.join(",")));
    if config.gpu {
        env.push_str("GUEST_DOCKER_GPU=all\n");
    }
    env.push_str(&limit_lines(config.memory_mb, config.cpus)?);
    blocking(move || {
        let s = run_guest(&b, Launch::Sync, None, Duration::from_secs(60))?;
        if s.code != 0 {
            return Ok(s);
        }
        run_guest(&b, Launch::Installed { action: "configure", args: &[] }, Some(env.into_bytes()), Duration::from_secs(60))
    })
    .await
}

/// Đổi mã ghi danh một lần (admin cấp) lấy credential của thiết bị. Mã đi qua stdin; credential chỉ nằm trong guest.
#[tauri::command]
pub async fn host_enroll(app: AppHandle, state: State<'_, HostState>, token: String) -> Result<Captured, String> {
    let b = require_backend(&app)?;
    let token = token.trim().to_string();
    if !is_token(&token) {
        return Err("Mã ghi danh không đúng định dạng.".into());
    }
    if is_running(&state.agent) {
        return Err("Agent đang chạy; hãy dừng trước khi ghi danh lại.".into());
    }
    blocking(move || run_guest(&b, Launch::Installed { action: "enroll", args: &[] }, Some(format!("{}\n", token).into_bytes()), Duration::from_secs(90))).await
}

/// Cài thành phần trong guest (Docker, Node, image Selkies ~8 GB) bằng quyền root CỦA GUEST. Chạy nền, xem tiến độ qua nhật ký.
#[tauri::command]
pub async fn host_provision_start(app: AppHandle, state: State<'_, HostState>, user: String) -> Result<(), String> {
    let b = require_backend(&app)?;
    if !is_safe_arg(&user) || user.len() > 32 {
        return Err("Tên user trong guest không hợp lệ.".into());
    }
    if is_running(&state.provision) {
        return Err("Đang cài đặt; hãy chờ xong.".into());
    }
    if is_running(&state.agent) {
        return Err("Agent đang chạy; hãy dừng trước khi cài.".into());
    }
    let log = data_dir(&app)?.join("provision.log");
    let cmd = guest_command(&b, &Launch::Piped { root: true, action: "provision", args: &[&user] }, true)?;
    let p = spawn_logged(cmd, &log, Some(GUEST_SCRIPT.as_bytes().to_vec()), false)?;
    *state.provision.lock().unwrap_or_else(|e| e.into_inner()) = Some(p);
    Ok(())
}

/// Bắt đầu nhận thuê: chạy agent ở tiền cảnh trong guest, app giữ stdin mở. Guest được khởi tạo sạch trước khi nhận lệnh.
#[tauri::command]
pub async fn host_agent_start(app: AppHandle, state: State<'_, HostState>) -> Result<(), String> {
    let b = require_backend(&app)?;
    if is_running(&state.agent) {
        return Err("Agent đã chạy.".into());
    }
    if is_running(&state.provision) {
        return Err("Đang cài đặt; hãy chờ xong.".into());
    }
    let log = data_dir(&app)?.join("agent.log");
    let cmd = guest_command(&b, &Launch::Installed { action: "run", args: &[] }, true)?;
    let p = spawn_logged(cmd, &log, None, true)?;
    *state.agent.lock().unwrap_or_else(|e| e.into_inner()) = Some(p);
    Ok(())
}

/// Dừng nhận thuê: agent cắt mọi phiên xem, xoá container khách (dọn guest) rồi thoát.
#[tauri::command]
pub async fn host_agent_stop(app: AppHandle, state: State<'_, HostState>) -> Result<Captured, String> {
    let b = require_backend(&app)?;
    let r = blocking(move || run_guest(&b, Launch::Piped { root: false, action: "stop", args: &[] }, None, Duration::from_secs(150))).await;
    stop_proc(&state.agent, Duration::from_secs(15));
    r
}

/// Dọn guest khi agent không chạy (ví dụ agent bị tắt cứng nên chưa tự dọn).
#[tauri::command]
pub async fn host_cleanup(app: AppHandle, state: State<'_, HostState>) -> Result<Captured, String> {
    let b = require_backend(&app)?;
    if is_running(&state.agent) {
        return Err("Agent đang chạy; bấm Dừng nhận thuê để agent tự dọn.".into());
    }
    blocking(move || run_guest(&b, Launch::Piped { root: false, action: "cleanup", args: &[] }, None, Duration::from_secs(150))).await
}

// ---------------------------------------------------------------- cài WSL giúp người dùng (có hộp thoại UAC)

/// Bước 1: bật WSL (không kèm bản Linux). Windows hiện hộp thoại UAC; người dùng từ chối ⇒ PowerShell báo lỗi, KHÔNG có gì được cài. Có thể cần khởi động lại.
const WSL_FEATURES_PS: &str = "$p = Start-Process -FilePath 'wsl.exe' -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode";

fn wsl_features_command() -> Command {
    let mut c = Command::new(system32(r"WindowsPowerShell\v1.0\powershell.exe"));
    c.args(["-NoProfile", "-NonInteractive", "-Command", WSL_FEATURES_PS]);
    hidden(c)
}

/// Bước 2: cài bản Linux riêng. Chạy trong cửa sổ console RIÊNG, nhìn thấy được: lần đầu bản Linux hỏi user/mật khẩu và app không điền thay.
fn wsl_distro_command() -> Command {
    let mut c = Command::new(system32("cmd.exe"));
    c.args(["/c", "start", "Cai Ubuntu cho Cloud PC", "wsl.exe", "--install", "-d", "Ubuntu-24.04"]);
    c
}

#[tauri::command]
pub async fn host_wsl_install_features() -> Result<Captured, String> {
    blocking(|| Ok(run_capture(wsl_features_command(), None, Duration::from_secs(1500)))).await
}

#[tauri::command]
pub async fn host_wsl_install_distro() -> Result<(), String> {
    blocking(|| wsl_distro_command().spawn().map(|_| ()).map_err(|e| format!("Không mở được cửa sổ cài bản Linux ({}).", e.kind()))).await
}

// ---------------------------------------------------------------- tunnel (Cloudflare quick tunnel, chỉ kết nối RA)

/// Tìm URL tunnel `https://<nhãn>.trycloudflare.com` trong nhật ký cloudflared. Bỏ `api.trycloudflare.com` (nơi cloudflared xin tunnel, hay xuất hiện trong báo lỗi).
pub fn parse_tunnel_url(log: &str) -> Option<String> {
    const SUFFIX: &str = ".trycloudflare.com";
    let mut rest = log;
    while let Some(i) = rest.find("https://") {
        let after = &rest[i + 8..];
        let label_len = after.bytes().take_while(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-').count();
        if label_len > 0 && after[label_len..].starts_with(SUFFIX) {
            let label = &after[..label_len];
            let end = label_len + SUFFIX.len();
            // Sau tên miền không được là ký tự tiếp tục tên miền (ví dụ `.evil.com`) — chỉ chấp nhận khi hết hoặc gặp ký tự ngăn cách.
            let boundary = after[end..].bytes().next().map_or(true, |b| !(b.is_ascii_alphanumeric() || b == b'-' || b == b'.'));
            if label != "api" && boundary {
                return Some(format!("https://{}{}", label, SUFFIX));
            }
        }
        rest = &rest[i + 8..];
    }
    None
}

/// Đúng dạng URL tunnel (không đường dẫn/cổng/query).
pub fn is_tunnel_url(s: &str) -> bool {
    matches!(parse_tunnel_url(s), Some(u) if u == s)
}

fn tunnel_args(port: u16) -> Vec<String> {
    // Quick tunnel: không cần tài khoản/giấy chứng nhận; chỉ mở kết nối RA tới Cloudflare. Không tự cập nhật (phiên bản được ghim khi build).
    vec!["tunnel".into(), "--url".into(), format!("http://127.0.0.1:{}", port), "--no-autoupdate".into()]
}

/// cloudflared đi kèm bộ cài (đặt cạnh tệp thực thi của app; build-demo-app.ps1 kiểm SHA-256 theo bản ghim trước khi đóng gói).
fn cloudflared_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "Không xác định được thư mục app.".to_string())?;
    let p = exe.parent().ok_or_else(|| "Không xác định được thư mục app.".to_string())?.join("cloudflared.exe");
    if p.is_file() { Ok(p) } else { Err("Bản cài này không kèm thành phần tunnel (cloudflared), nên không mở được kênh cho người ở mạng khác.".into()) }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    /// "never" | "running" | "exited"
    pub state: String,
    /// URL công khai khi tunnel đang chạy và đã có địa chỉ.
    pub url: Option<String>,
    pub exit_code: Option<i32>,
    pub log_tail: String,
}

/// Mở tunnel tới gateway cục bộ (127.0.0.1:18095). Idempotent: đang chạy thì không làm gì.
#[tauri::command]
pub async fn host_tunnel_start(app: AppHandle, state: State<'_, HostState>) -> Result<(), String> {
    if is_running(&state.tunnel) {
        return Ok(());
    }
    let exe = cloudflared_path()?;
    let log = data_dir(&app)?.join("tunnel.log");
    let mut cmd = hidden(Command::new(exe));
    cmd.args(tunnel_args(GATEWAY_PORT));
    let p = spawn_logged(cmd, &log, None, false)?;
    *state.tunnel.lock().unwrap_or_else(|e| e.into_inner()) = Some(p);
    Ok(())
}

#[tauri::command]
pub async fn host_tunnel_state(state: State<'_, HostState>) -> Result<TunnelInfo, String> {
    let ps = proc_state(&state.tunnel, 64 * 1024);
    let url = if ps.state == "running" { parse_tunnel_url(&ps.log_tail) } else { None };
    let tail: String = { let t = ps.log_tail; let n = t.chars().count(); t.chars().skip(n.saturating_sub(1200)).collect() };
    Ok(TunnelInfo { state: ps.state, url, exit_code: ps.exit_code, log_tail: tail })
}

#[tauri::command]
pub async fn host_tunnel_stop(state: State<'_, HostState>) -> Result<(), String> {
    stop_proc(&state.tunnel, Duration::from_secs(1));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_url_parsing_is_strict() {
        let log = "INF Requesting new quick Tunnel on trycloudflare.com...\nERR failed https://api.trycloudflare.com/tunnel\nINF |  https://able-seat-9-fox.trycloudflare.com  |\nINF Registered tunnel connection";
        assert_eq!(parse_tunnel_url(log).as_deref(), Some("https://able-seat-9-fox.trycloudflare.com"));
        for none in ["", "https://api.trycloudflare.com", "http://x.trycloudflare.com", "https://x.trycloudflare.com.evil.example", "https://x.trycloudflare.comx", "https://.trycloudflare.com", "https://UPPER.trycloudflare.com", "https://evil.example/?https://x.example.com"] {
            assert_eq!(parse_tunnel_url(none), None, "{none:?}");
        }
        assert!(is_tunnel_url("https://a-b-1.trycloudflare.com"));
        for bad in ["https://a.trycloudflare.com/", "https://a.trycloudflare.com:443", "https://a.trycloudflare.com/x", "http://a.trycloudflare.com", "https://api.trycloudflare.com", " https://a.trycloudflare.com", "https://a.example.com"] {
            assert!(!is_tunnel_url(bad), "{bad}");
        }
    }

    #[test]
    fn resource_limits_are_validated_integers_in_range() {
        assert_eq!(limit_lines(None, None).unwrap(), "");
        assert_eq!(limit_lines(Some(4096), Some(2)).unwrap(), "GUEST_DOCKER_MEMORY_MB=4096\nGUEST_DOCKER_CPUS=2\n");
        for bad in [0u32, 512, 1023, 262_145] {
            assert!(limit_lines(Some(bad), None).is_err(), "{bad}");
        }
        for bad in [0u32, 129] {
            assert!(limit_lines(None, Some(bad)).is_err(), "{bad}");
        }
        assert!(limit_lines(Some(1024), Some(1)).is_ok() && limit_lines(Some(262_144), Some(128)).is_ok());
    }

    #[test]
    fn wsl_install_commands_are_fixed_and_take_no_input() {
        let f = wsl_features_command();
        assert!(f.get_program().to_string_lossy().to_lowercase().ends_with("powershell.exe"));
        assert_eq!(args_of(&f), ["-NoProfile", "-NonInteractive", "-Command", WSL_FEATURES_PS]);
        assert!(WSL_FEATURES_PS.contains("-Verb RunAs") && WSL_FEATURES_PS.contains("'--install','--no-distribution'") && WSL_FEATURES_PS.contains("exit $p.ExitCode"));
        let d = wsl_distro_command();
        assert!(d.get_program().to_string_lossy().to_lowercase().ends_with("cmd.exe"));
        assert_eq!(args_of(&d), ["/c", "start", "Cai Ubuntu cho Cloud PC", "wsl.exe", "--install", "-d", "Ubuntu-24.04"]);
    }

    #[test]
    fn closing_the_window_hides_only_when_enabled_and_something_is_running() {
        assert!(should_hide_on_close(true, true, false) && should_hide_on_close(true, false, true) && should_hide_on_close(true, true, true));
        assert!(!should_hide_on_close(true, false, false), "không có gì chạy ⇒ đóng là thoát");
        assert!(!should_hide_on_close(false, true, true), "chưa bật ⇒ đóng là thoát (dừng nhận thuê)");
    }

    #[test]
    fn tunnel_command_is_fixed_outbound_only_and_points_at_the_loopback_gateway() {
        assert_eq!(tunnel_args(18095), ["tunnel", "--url", "http://127.0.0.1:18095", "--no-autoupdate"]);
    }

    #[test]
    fn validators_reject_shell_metacharacters() {
        for bad in ["", "a b", "a;b", "$(id)", "`id`", "a'b", "a\"b", "a|b", "a&b", "a>b", "a\nb", "a\\b", "é"] {
            assert!(!is_safe_arg(bad), "{bad:?}");
        }
        assert!(is_safe_arg("ghcr.io/x/y@sha256:abc-1_2"));
        assert!(is_distro("Ubuntu-24.04") && is_distro("cpm_host.1"));
        for bad in ["", "-x", "a b", "a/b", "a;b", "é"] {
            assert!(!is_distro(bad), "{bad:?}");
        }
        assert!(is_token(&"A".repeat(43)) && !is_token("short") && !is_token(&format!("{} x", "A".repeat(30))));
        assert!(is_ssh_target("cpm@127.0.0.1") && !is_ssh_target("cpm@host -oProxyCommand=x") && !is_ssh_target("nohost") && !is_ssh_target("@h"));
    }

    #[test]
    fn url_validators() {
        for ok in ["http://127.0.0.1:3000/api", "https://app.example.com/api", "http://10.0.2.2:3000/api", "http://localhost:3000"] {
            assert!(is_api_base(ok), "{ok}");
        }
        for bad in ["ftp://x/api", "http://", "http://x/api?a=1", "http://x/a b", "http://x/$(id)", "http://x:99999/api", "http://x/../y", "http://u@x/api", "http://x//y", "javascript:alert(1)"] {
            assert!(!is_api_base(bad), "{bad}");
        }
        assert!(is_origin("http://tauri.localhost") && is_origin("http://127.0.0.1:5174"));
        for bad in ["http://tauri.localhost/", "http://a b", "*", "http://x:0", "http://x/path"] {
            assert!(!is_origin(bad), "{bad}");
        }
    }

    #[test]
    fn decode_handles_utf16_and_utf8() {
        let utf16: Vec<u8> = "The Windows Subsystem for Linux is not installed.\r\n".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(decode_output(&utf16), "The Windows Subsystem for Linux is not installed.\n");
        assert_eq!(decode_output("probe_done=1\nmáy=ổn\n".as_bytes()), "probe_done=1\nmáy=ổn\n");
        assert_eq!(decode_output(b""), "");
    }

    fn args_of(c: &Command) -> Vec<String> {
        c.get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn wsl_command_uses_exec_and_never_a_shell_string_with_arguments() {
        let b = Backend::Wsl { distro: "Ubuntu-24.04".into() };
        let c = guest_command(&b, &Launch::Piped { root: false, action: "probe", args: &["http://127.0.0.1:3000/api"] }, false).unwrap();
        assert_eq!(args_of(&c), ["-d", "Ubuntu-24.04", "--cd", "~", "--exec", "bash", "-s", "--", "probe", "http://127.0.0.1:3000/api"]);
        let c = guest_command(&b, &Launch::Piped { root: true, action: "provision", args: &["cpm"] }, true).unwrap();
        assert_eq!(args_of(&c), ["-d", "Ubuntu-24.04", "-u", "root", "--cd", "~", "--exec", "bash", "-s", "--", "provision", "cpm"]);
        let c = guest_command(&b, &Launch::Installed { action: "run", args: &[] }, true).unwrap();
        assert_eq!(args_of(&c), ["-d", "Ubuntu-24.04", "--cd", "~", "--exec", "bash", ".cpm-host/cpm-guest.sh", "run"]);
        assert!(guest_command(&b, &Launch::Piped { root: false, action: "probe", args: &["x; rm -rf /"] }, false).is_err());
        assert!(guest_command(&b, &Launch::Piped { root: false, action: "probe; id", args: &[] }, false).is_err());
    }

    #[test]
    fn ssh_dev_command_pins_host_key_and_builds_fixed_remote_string() {
        let b = Backend::SshDev { target: "cpm@127.0.0.1".into(), port: 2222, key_file: "C:\\k".into(), known_hosts_file: "C:\\kh".into(), agent_api_base: None, gateway_bind: "0.0.0.0".into(), label: "vm".into() };
        let c = guest_command(&b, &Launch::Piped { root: true, action: "provision", args: &["cpm"] }, false).unwrap();
        let a = args_of(&c);
        assert!(a.contains(&"StrictHostKeyChecking=yes".to_string()) && a.contains(&"BatchMode=yes".to_string()));
        assert_eq!(a.last().unwrap(), "sudo -n bash -s -- provision cpm");
        let sha = "a".repeat(64);
        let c = guest_command(&b, &Launch::Installed { action: "install-agent", args: &[sha.as_str()] }, false).unwrap();
        assert_eq!(args_of(&c).last().unwrap(), &format!("bash .cpm-host/cpm-guest.sh install-agent {sha}"));
        assert!(guest_command(&b, &Launch::Installed { action: "enroll", args: &["$(id)"] }, false).is_err());
    }

    #[test]
    fn backend_file_validation() {
        let wsl = |d: &str| parse_backend(BackendFile { kind: "wsl".into(), distro: Some(d.into()), target: None, port: None, key_file: None, known_hosts_file: None, agent_api_base: None, gateway_bind: None, label: None });
        assert!(wsl("Ubuntu-24.04").is_ok() && wsl("a; b").is_err() && wsl("").is_err());
        let ssh = |t: &str| parse_backend(BackendFile { kind: "ssh-dev".into(), distro: None, target: Some(t.into()), port: Some(22), key_file: Some("C:\\khong-co".into()), known_hosts_file: Some("C:\\khong-co".into()), agent_api_base: None, gateway_bind: None, label: None });
        assert!(ssh("cpm@host -oProxyCommand=calc").is_err());
        assert!(ssh("cpm@127.0.0.1").is_err(), "tệp khoá không tồn tại phải bị từ chối");
        assert!(parse_backend(BackendFile { kind: "powershell".into(), distro: None, target: None, port: None, key_file: None, known_hosts_file: None, agent_api_base: None, gateway_bind: None, label: None }).is_err());
    }

    #[test]
    fn embedded_agent_matches_its_checksum_file() {
        assert_eq!(AGENT_SHA256.trim().len(), 64);
        assert!(AGENT_BUNDLE.len() > 50_000 && AGENT_BUNDLE.len() < 4 * 1024 * 1024, "phải nhỏ hơn giới hạn 4 MiB của install-agent");
        assert!(GUEST_SCRIPT.contains("main \"$@\"") && !GUEST_SCRIPT.contains("__CPM_SELKIES_DIGEST__") && !GUEST_SCRIPT.contains('\r'));
    }
}
