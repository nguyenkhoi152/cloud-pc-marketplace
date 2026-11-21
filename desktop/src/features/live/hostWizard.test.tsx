import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WizardItem } from "@/domain/hostWizard";
import { BackgroundAgentNotice, Checklist, CheckTable, IndeterminateBar, WizardFooter, WizardNav } from "./HostWizard";

const items: WizardItem[] = [
  { id: "intro", label: "Quyền và trách nhiệm", state: "done", reachable: true },
  { id: "check", label: "Kiểm tra máy", state: "current", reachable: true },
  { id: "install", label: "Cài đặt thành phần", state: "todo", reachable: false },
];

describe("WizardNav", () => {
  const html = renderToStaticMarkup(<WizardNav items={items} selected="check" onSelect={() => {}} />);
  it("bước đã xong có dấu ✓, bước đang xem có aria-current=step", () => {
    expect(html).toContain("✓");
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-current="step"[^>]*data-step="check"|data-step="check"[^>]*aria-current="step"/);
  });
  it("bước chưa mở được thì bị khóa (disabled) và đọc ra là chưa mở được", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-step="install"|<button[^>]*data-step="install"[^>]*disabled=""/);
    expect(html).toContain("chưa mở được");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(1);
  });
  it("hiện số thứ tự cho bước chưa xong", () => {
    expect(html).toMatch(/>2<\/span>Kiểm tra máy/);
    expect(html).toMatch(/>3<\/span>Cài đặt thành phần/);
  });
});

describe("WizardFooter", () => {
  it("bước đầu không có Quay lại; có lý do khi Tiếp tục bị khóa", () => {
    const h = renderToStaticMarkup(<WizardFooter onNext={() => {}} nextDisabled why="Cần xác nhận đã đọc" />);
    expect(h).not.toContain("Quay lại");
    expect(h).toContain("Cần xác nhận đã đọc");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Tiếp tục/);
  });
  it("bước cuối (không có Tiếp tục) không hiện lý do thừa", () => {
    const h = renderToStaticMarkup(<WizardFooter onBack={() => {}} nextDisabled why="Hoàn tất các mục trên để tiếp tục" />);
    expect(h).toContain("Quay lại");
    expect(h).not.toContain("Tiếp tục");
    expect(h).not.toContain("Hoàn tất các mục trên");
  });
  it("không hiện lý do khi Tiếp tục đã bấm được", () => {
    const h = renderToStaticMarkup(<WizardFooter onBack={() => {}} onNext={() => {}} why="vì sao" />);
    expect(h).not.toContain("vì sao");
    expect(h).not.toMatch(/disabled=""/);
  });
});

describe("CheckTable", () => {
  const html = renderToStaticMarkup(
    <CheckTable rows={[
      { label: "CPU", value: "16 nhân", status: "pass" },
      { label: "GPU", value: "Không phát hiện", status: "warn" },
      { label: "WSL", value: "Chưa cài", status: "fail" },
      { label: "Bản Linux", value: "Cần WSL trước", status: "wait" },
      { label: "RAM", value: "Đang đọc", status: "pending" },
    ]} />,
  );
  it("mỗi dòng có kết quả bằng chữ (không chỉ bằng màu)", () => {
    for (const t of ["Đạt", "Lưu ý", "Chưa đạt", "Chờ bước trước", "Đang kiểm tra"]) expect(html).toContain(t);
  });
  it("giữ trạng thái ở thuộc tính để kiểm thử, và chỉ dòng 'đang đọc' có vòng xoay", () => {
    for (const s of ["pass", "warn", "fail", "wait", "pending"]) expect(html).toContain(`data-status="${s}"`);
    expect((html.match(/animate-\[spin_1s_linear_infinite\]/g) ?? []).length).toBe(1);
  });
  it("mục chờ bước trước không bị tô đỏ như lỗi", () => {
    const wait = html.split("<li").find((x) => x.includes('data-status="wait"'))!;
    expect(wait).not.toContain("text-danger");
  });
});

describe("Checklist và thanh tiến trình", () => {
  const html = renderToStaticMarkup(
    <Checklist items={[
      { id: "a", label: "Docker và Node.js", state: "done" },
      { id: "b", label: "Môi trường desktop", state: "doing" },
      { id: "c", label: "Dịch vụ cho thuê", state: "todo" },
      { id: "d", label: "Kết nối tới máy chủ", state: "warn" },
      { id: "e", label: "Hỏng", state: "fail" },
    ]} />,
  );
  it("mỗi bước có trạng thái cho trình đọc màn hình", () => {
    for (const t of ["đã xong", "đang làm", "chưa tới", "cần bạn làm", "gặp sự cố"]) expect(html).toContain(t);
    for (const s of ["done", "doing", "todo", "warn", "fail"]) expect(html).toContain(`data-state="${s}"`);
  });
  it("thanh tiến trình không bịa phần trăm", () => {
    const bar = renderToStaticMarkup(<IndeterminateBar label="Đang cài" />);
    expect(bar).toContain('role="progressbar"');
    expect(bar).toContain('aria-busy="true"');
    expect(bar).not.toContain("aria-valuenow");
    expect(bar).not.toMatch(/\d+\s*%/);
  });
});

describe("BackgroundAgentNotice (dịch vụ cho thuê chạy nền không do app này bật)", () => {
  const M = "99999999-8888-7777-6666-555555555555";
  const noop = () => {};
  const render = (kind: "none" | "mine" | "other" | "unknown", confirming = false, machineName?: string) =>
    renderToStaticMarkup(<BackgroundAgentNotice agent={kind === "none" ? { kind } : { kind, machineId: M }} machineName={machineName} confirming={confirming} busy={false} onAsk={noop} onCancel={noop} onStop={noop} />);
  it("không có agent chạy nền thì không hiện gì", () => {
    expect(render("none")).toBe("");
  });
  it("máy của tài khoản khác: nói rõ máy nào, nói rõ vì sao ghi danh bị chặn, có nút dừng", () => {
    const h = render("other");
    expect(h).toContain('data-kind="other"');
    expect(h).toContain("99999999…");
    expect(h).toContain("không thuộc tài khoản đang đăng nhập");
    expect(h).toContain("Bản Linux không cho ghi danh");
    expect(h).toContain("Dừng dịch vụ đó");
    expect(h).toContain("offline");
  });
  it("máy của chính tài khoản này chạy nền: có tên máy và có nút dừng", () => {
    const h = render("mine", false, "Máy của tôi");
    expect(h).toContain('data-kind="mine"');
    expect(h).toContain("Máy của tôi (99999999…)");
    expect(h).toContain("Dừng dịch vụ đó");
  });
  it("chưa rõ máy nào: vẫn cho dừng, không khẳng định là của ai", () => {
    const h = render("unknown");
    expect(h).toContain('data-kind="unknown"');
    expect(h).not.toContain("không thuộc tài khoản");
  });
  it("hỏi xác nhận trước khi dừng: chỉ khi xác nhận mới hiện nút Dừng và dọn dẹp, và nói rõ hậu quả", () => {
    const ask = render("other", false);
    expect(ask).not.toContain("Dừng và dọn dẹp");
    const confirm = render("other", true);
    expect(confirm).toContain("Dừng và dọn dẹp");
    expect(confirm).toContain("Không");
    expect(confirm).toContain("dữ liệu trong môi trường của khách bị xóa");
    expect(confirm).not.toContain("Dừng dịch vụ đó");
  });
});
