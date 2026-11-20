#!/usr/bin/env bash
# cpm-guest.sh — TẬP LỆNH CỐ ĐỊNH chạy trong guest Linux của máy host (WSL2 trên Windows, hoặc máy/VM Linux).
# App Companion (chế độ Cho thuê) gọi tệp này; không có đường nào để người thuê hay máy chủ đưa lệnh tuỳ ý vào đây:
#   - hành động là một trong danh sách dưới; tham số bị kiểm dạng lại ở đây (chỉ chữ, số và . _ : / @ -);
#   - cấu hình agent đi qua stdin, từng dòng TÊN=GIÁ_TRỊ thuộc danh sách cho phép, KHÔNG bao giờ được `source`/`eval`;
#   - token ghi danh đi qua stdin (không nằm trong dòng lệnh/biến môi trường).
# Toàn bộ thân tệp nằm trong hàm và chỉ gọi `main` ở dòng cuối: khi chạy kiểu `bash -s` (script qua stdin), bash đọc hết tệp
# trước khi chạy nên tiến trình con không thể đọc nhầm phần còn lại của script.
#
# Hành động (người dùng thường):  probe [apiBase] | sync-check | install-agent <sha256> | configure | enroll | run | stop | cleanup
# Hành động (root trong guest):    provision <user>
set -euo pipefail
umask 077

CPM_GUEST_VERSION=1
BASE="${HOME:-/root}/.cpm-host"
AGENT="$BASE/cpm-host-agent.cjs"
ENVF="$BASE/agent.env"
DATA="$BASE/data"
PIDF="$BASE/agent.pid"
CONTAINER="selkies"
SELKIES_PORT=8080
# Image Selkies ghim theo digest (bản 2.2.1, desktop ubuntu26.04 — bản đã chạy thật trong VM thử ngày 09–10/11/2026).
IMAGE_REF="ghcr.io/selkies-project/selkies/desktop@sha256:5e877dfc8280afc2326bb24a3a57d37d2edb081e595014842aff1d6cd3569015"
IMAGE_TAG_HINT="ghcr.io/selkies-project/selkies/desktop:2.2.1-ubuntu26.04"

say() { printf '%s\n' "$*"; }
log() { printf '[cpm] %s\n' "$*"; }
die() { printf 'error=%s\n' "$*"; exit 1; }
safe_arg() { [[ "$1" =~ ^[A-Za-z0-9._:/@-]{1,300}$ ]]; }
have() { command -v "$1" >/dev/null 2>&1; }

docker_ok() { have docker && docker info >/dev/null 2>&1; }
image_id() { docker image inspect --format '{{.Id}}' "$IMAGE_REF" 2>/dev/null || true; }
agent_pid() {
  local p
  [ -f "$PIDF" ] || return 1
  p="$(tr -cd '0-9' <"$PIDF" | head -c 10)"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null || return 1
  # Chỉ nhận đúng tiến trình agent (tránh pid bị tái sử dụng).
  tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null | grep -q 'cpm-host-agent' || return 1
  printf '%s' "$p"
}

do_probe() {
  local api="${1:-}" v m
  say "probe_version=$CPM_GUEST_VERSION"
  # shellcheck disable=SC1091
  say "os_id=$( (. /etc/os-release 2>/dev/null && printf '%s' "${ID:-}") || true)"
  # shellcheck disable=SC1091
  say "os_version=$( (. /etc/os-release 2>/dev/null && printf '%s' "${VERSION_ID:-}") || true)"
  say "kernel=$(uname -r 2>/dev/null || true)"
  if grep -qi microsoft /proc/version 2>/dev/null; then say "is_wsl=1"; else say "is_wsl=0"; fi
  if [ -d /run/systemd/system ]; then say "systemd=1"; else say "systemd=0"; fi
  say "user=$(id -un 2>/dev/null || true)"
  if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then say "in_docker_group=1"; else say "in_docker_group=0"; fi
  say "cpu_count=$(nproc 2>/dev/null || true)"
  # Tên CPU để hiển thị cho người thuê (chỉ đọc; thiếu thì để trống).
  say "cpu_model=$(awk -F': *' '/^model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null | tr -cd 'A-Za-z0-9 ._()@/-' | head -c 80)"
  say "mem_total_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || true)"
  say "disk_free_gb=$(df -Pk "${HOME:-/}" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1048576}' || true)"

  if have docker; then say "docker_cli=$(docker --version 2>/dev/null | sed -n 's/^Docker version \([0-9][0-9.]*\).*/\1/p' | head -n1)"; else say "docker_cli="; fi
  # docker_sock: dịch vụ docker đang chạy (có socket). docker_daemon: user này GỌI được docker (đã thuộc nhóm docker).
  if [ -S /var/run/docker.sock ]; then say "docker_sock=1"; else say "docker_sock=0"; fi
  if docker_ok; then
    say "docker_daemon=1"
    v="$(image_id)"
    if [ -n "$v" ]; then say "image_present=1"; else say "image_present=0"; fi
    if docker info --format '{{range $k, $_ := .Runtimes}}{{$k}} {{end}}' 2>/dev/null | grep -qw nvidia; then say "docker_nvidia_runtime=1"; else say "docker_nvidia_runtime=0"; fi
    v="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || true)"
    if [ -n "$v" ]; then say "container=${v%%|*}"; say "container_health=${v##*|}"; else say "container=missing"; say "container_health="; fi
  else
    say "docker_daemon=0"; say "image_present=0"; say "docker_nvidia_runtime=0"; say "container=unknown"; say "container_health="
  fi

  if have node; then say "node=$(node --version 2>/dev/null | tr -d 'v')"; else say "node="; fi
  if [ -f "$AGENT" ]; then say "agent_installed=1"; say "agent_sha256=$(sha256sum "$AGENT" 2>/dev/null | cut -d' ' -f1)"; else say "agent_installed=0"; say "agent_sha256="; fi
  if [ -f "$ENVF" ]; then say "configured=1"; else say "configured=0"; fi
  # Mức RAM (MiB) và số CPU đang cấu hình cho container khách trong tệp cấu hình của agent; thiếu thì để trống (không đoán).
  say "applied_memory_mb=$(sed -n 's/^GUEST_DOCKER_MEMORY_MB=\([0-9]\{1,7\}\)$/\1/p' "$ENVF" 2>/dev/null | tail -n1)"
  say "applied_cpus=$(sed -n 's/^GUEST_DOCKER_CPUS=\([0-9]\{1,3\}\)$/\1/p' "$ENVF" 2>/dev/null | tail -n1)"
  if have node && [ -f "$AGENT" ]; then
    AGENT_DATA_DIR="$DATA" node "$AGENT" status 2>/dev/null | grep -E '^(enrolled|machine_id)=' || { say "enrolled=0"; say "machine_id="; }
  else
    say "enrolled=0"; say "machine_id="
  fi
  if v="$(agent_pid)"; then say "agent_running=1"; say "agent_pid=$v"; else say "agent_running=0"; say "agent_pid="; fi

  # GPU: chỉ là THÔNG TIN phát hiện được; chưa phải bằng chứng Selkies mã hoá bằng GPU.
  if [ -e /dev/dxg ]; then say "gpu_dxg=1"; else say "gpu_dxg=0"; fi
  if [ -e /dev/dri/renderD128 ]; then say "gpu_render_node=1"; else say "gpu_render_node=0"; fi
  v=""
  for smi in nvidia-smi /usr/lib/wsl/lib/nvidia-smi; do
    if have "$smi" || [ -x "$smi" ]; then v="$("$smi" --query-gpu=name --format=csv,noheader 2>/dev/null | head -n1 | tr -cd 'A-Za-z0-9 ._()/-' | head -c 80)"; [ -n "$v" ] && break; fi
  done
  say "gpu_nvidia=$v"
  # VRAM (MiB) của GPU vừa đọc được tên; không có tên thì không đoán.
  m=""
  if [ -n "$v" ]; then
    for smi in nvidia-smi /usr/lib/wsl/lib/nvidia-smi; do
      if have "$smi" || [ -x "$smi" ]; then m="$("$smi" --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -cd '0-9' | head -c 7)"; [ -n "$m" ] && break; fi
    done
  fi
  say "gpu_vram_mb=$m"

  if [ -n "$api" ] && safe_arg "$api" && have node; then
    if CPM_API="$api" node -e 'fetch(process.env.CPM_API + "/health", { signal: AbortSignal.timeout(6000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' 2>/dev/null; then say "api_reachable=1"; else say "api_reachable=0"; fi
  else
    say "api_reachable=unknown"
  fi
  say "probe_done=1"
}

# Root trong guest: cài Docker + Node, bật dịch vụ docker, thêm user vào nhóm docker, tải image Selkies (~8 GB) nếu chưa có.
do_provision() {
  local user="${1:-}"
  [ "$(id -u)" = "0" ] || die "need_root"
  [[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "bad_user"
  id "$user" >/dev/null 2>&1 || die "no_such_user"
  have apt-get || die "unsupported_distro"
  export DEBIAN_FRONTEND=noninteractive
  local pkgs=()
  have docker || pkgs+=(docker.io)
  have node || pkgs+=(nodejs)
  have curl || pkgs+=(curl)
  [ -f /etc/ssl/certs/ca-certificates.crt ] || pkgs+=(ca-certificates)
  if [ "${#pkgs[@]}" -gt 0 ]; then
    log "cài gói: ${pkgs[*]}"
    apt-get update -y </dev/null
    apt-get install -y --no-install-recommends "${pkgs[@]}" </dev/null
  else
    log "docker, node, curl đã có sẵn"
  fi
  local major
  major="$(node --version 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p')"
  [ -n "$major" ] && [ "$major" -ge 18 ] || die "node_too_old"
  if ! docker info >/dev/null 2>&1; then
    log "bật dịch vụ docker"
    if [ -d /run/systemd/system ]; then systemctl enable --now docker </dev/null; else service docker start </dev/null; fi
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null 2>&1 || die "docker_start_failed"
  fi
  if ! id -nG "$user" | tr ' ' '\n' | grep -qx docker; then
    log "thêm $user vào nhóm docker"
    usermod -aG docker "$user"
  fi
  if [ -z "$(image_id)" ]; then
    log "tải image Selkies (khoảng 8 GB, một lần): $IMAGE_TAG_HINT"
    docker pull "$IMAGE_REF" </dev/null
  else
    log "image Selkies đã có"
  fi
  [ -n "$(image_id)" ] || die "image_missing_after_pull"
  say "provision_done=1"
}

# stdin = tệp agent đã đóng gói; tham số = sha256 mong đợi (do app tính từ tệp nó nhúng).
do_install_agent() {
  local want="${1:-}" got tmp
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "bad_sha256"
  mkdir -p "$BASE" "$DATA"
  tmp="$AGENT.new"
  head -c 4194304 >"$tmp"
  got="$(sha256sum "$tmp" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then rm -f "$tmp"; die "agent_checksum_mismatch"; fi
  mv -f "$tmp" "$AGENT"
  say "agent_sha256=$got"
  say "install_done=1"
}

# stdin = các dòng TÊN=GIÁ_TRỊ. Chỉ nhận tên trong danh sách và giá trị không có khoảng trắng/nháy/ký tự shell.
do_configure() {
  local line key val tmp n=0
  mkdir -p "$BASE" "$DATA"
  tmp="$ENVF.new"
  : >"$tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [ -z "$line" ] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]{0,63})=([A-Za-z0-9._:/@,+-]{0,400})$ ]] || { rm -f "$tmp"; die "config_bad_format"; }
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    case "$key" in
      AGENT_API_BASE|AGENT_INTERVAL_MS|GATEWAY_PUBLIC_URL|GATEWAY_PORT|GATEWAY_BIND|GATEWAY_ALLOWED_ORIGINS|GATEWAY_FRAME_ANCESTORS|GUEST_DOCKER_GPU|GUEST_DOCKER_MEMORY_MB|GUEST_DOCKER_CPUS) ;;
      *) rm -f "$tmp"; die "config_key_not_allowed" ;;
    esac
    printf '%s=%s\n' "$key" "$val" >>"$tmp"
    n=$((n + 1))
    [ "$n" -le 20 ] || { rm -f "$tmp"; die "config_too_long"; }
  done
  [ "$n" -gt 0 ] || { rm -f "$tmp"; die "config_empty"; }
  mv -f "$tmp" "$ENVF"
  say "configure_done=1"
}

need_agent() {
  have node || die "no_node"
  [ -f "$AGENT" ] || die "agent_not_installed"
  [ -f "$ENVF" ] || die "not_configured"
}

# stdin = token ghi danh một lần do admin cấp.
do_enroll() {
  need_agent
  if agent_pid >/dev/null; then die "agent_running"; fi
  mkdir -p "$DATA"
  AGENT_DATA_DIR="$DATA" node "$AGENT" --env-file "$ENVF" enroll --token-stdin 2>&1 | head -c 400 || die "enroll_failed"
  say ""
  say "enroll_done=1"
}

# Chạy ở TIỀN CẢNH. App của host giữ stdin mở; stdin đóng (app thoát) ⇒ agent tự dừng, cắt phiên và dọn guest.
do_run() {
  need_agent
  docker_ok || die "docker_unavailable"
  [ -n "$(image_id)" ] || die "image_missing"
  if agent_pid >/dev/null; then die "agent_running"; fi
  mkdir -p "$DATA"
  export AGENT_DATA_DIR="$DATA" AGENT_PID_FILE="$PIDF" AGENT_EXIT_ON_STDIN_CLOSE=1
  export GATEWAY_UPSTREAM="http://127.0.0.1:$SELKIES_PORT"
  export GUEST_MODE=docker GUEST_DOCKER_IMAGE="$IMAGE_REF" GUEST_DOCKER_CONTAINER="$CONTAINER"
  export GUEST_DOCKER_PUBLISH_ADDR=127.0.0.1 GUEST_DOCKER_HOST_PORT="$SELKIES_PORT" GUEST_CLEANUP_ON_EXIT=1
  exec node "$AGENT" --env-file "$ENVF" run
}

do_stop() {
  local p i
  if p="$(agent_pid)"; then
    kill -TERM "$p" 2>/dev/null || true
    for i in $(seq 1 90); do kill -0 "$p" 2>/dev/null || break; sleep 1; done
    if kill -0 "$p" 2>/dev/null; then kill -KILL "$p" 2>/dev/null || true; say "stop_forced=1"; fi
  fi
  rm -f "$PIDF"
  say "agent_running=0"
  say "stop_done=1"
}

# Dọn guest khi agent KHÔNG chạy (ví dụ agent bị tắt cứng nên chưa tự dọn): xoá container khách và mọi dữ liệu trong đó.
do_cleanup() {
  if agent_pid >/dev/null; then die "agent_running"; fi
  docker_ok || die "docker_unavailable"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then die "container_still_present"; fi
  say "container=missing"
  say "cleanup_done=1"
}

main() {
  local action="${1:-}" a
  shift || true
  for a in "$@"; do safe_arg "$a" || die "bad_arg"; done
  case "$action" in
    probe) do_probe "${1:-}" ;;
    provision) do_provision "${1:-}" ;;
    install-agent) do_install_agent "${1:-}" ;;
    configure) do_configure ;;
    enroll) do_enroll ;;
    run) do_run ;;
    stop) do_stop ;;
    cleanup) do_cleanup ;;
    *) die "unsupported_action" ;;
  esac
}

main "$@"
