import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { quote } from "@/domain/pricing";
import { hasIssues, validateWeekly } from "@/domain/schedule";
import type { Category } from "@/domain/types";
import { HOST_PROFILES } from "@/mock/fixtures";
import { useAppStore } from "@/state/store";
import { Badge } from "@/ui/badge";
import { Checkbox, Field, Input, Slider, Switch, Tabs } from "@/ui/controls";
import { Banner } from "@/ui/feedback";
import { Money } from "@/ui/page";
import { CATEGORY_LABEL } from "../renter/machineFormat";
import { ExceptionsEditor, UpcomingPreview, WeeklyEditor } from "./ScheduleEditor";

type Tab = "resources" | "price" | "weekly" | "exceptions";

export function useScheduleValid() {
  const c = useAppStore((s) => s.hostSetup.config);
  return !hasIssues(c.weekly, c.exceptions);
}

export function ConfigureForm() {
  const setup = useAppStore((s) => s.hostSetup);
  const patch = useAppStore((s) => s.patchHostConfig);
  const c = setup.config;
  const [tab, setTab] = useState<Tab>("resources");
  const profile = HOST_PROFILES.find((p) => p.id === setup.profileId) ?? HOST_PROFILES[0]!;
  const noGpu = !profile.gpu;
  const maxCores = Math.max(2, Math.floor(profile.cores * 0.75));
  const maxRam = Math.max(4, profile.ramGb - 8);
  const maxDisk = Math.max(50, Math.min(500, profile.freeDiskGb - 50));
  const weeklyIssues = validateWeekly(c.weekly).reduce((n, d) => n + d.length, 0);
  const q = quote(c.pricePer15, 60);

  const toggleCat = (cat: Category, on: boolean) => patch({ categories: on ? [...c.categories, cat] : c.categories.filter((x) => x !== cat) });

  return (
    <Tabs<Tab>
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "resources", label: "Tài nguyên" },
        { value: "price", label: "Giá" },
        { value: "weekly", label: <>Lịch tuần {weeklyIssues > 0 && <Badge tone="danger" icon={false}>{weeklyIssues} lỗi</Badge>}</> },
        { value: "exceptions", label: <>Ngoại lệ {c.exceptions.length > 0 && <span className="num rounded-full bg-sky px-1.5 text-[11px]">{c.exceptions.length}</span>}</> },
      ]}
    >
      <div className="pt-5">
        {tab === "resources" && (
          <div className="grid max-w-3xl grid-cols-2 gap-x-10 gap-y-6">
            <Field label={`Số nhân CPU chia sẻ: ${c.cores}`} hint={`Tối đa ${maxCores}/${profile.cores} nhân; phần còn lại giữ cho Windows.`}>
              <Slider label="Số nhân CPU chia sẻ" value={Math.min(c.cores, maxCores)} min={2} max={maxCores} onChange={(v) => patch({ cores: v })} />
            </Field>
            <Field label={`RAM chia sẻ: ${c.ramGb} GB`} hint={`Tối đa ${maxRam}/${profile.ramGb} GB; luôn giữ ít nhất 8 GB cho Windows.`}>
              <Slider label="RAM chia sẻ" value={Math.min(c.ramGb, maxRam)} min={4} max={maxRam} step={2} onChange={(v) => patch({ ramGb: v })} />
            </Field>
            <Field label={`Dung lượng ổ cho phiên: ${c.storageGb} GB`} hint={`Ổ trống ${profile.freeDiskGb} GB (số liệu mô phỏng).`}>
              <Slider label="Dung lượng ổ cho phiên" value={Math.min(c.storageGb, maxDisk)} min={50} max={maxDisk} step={10} onChange={(v) => patch({ storageGb: v })} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Chia sẻ GPU</span>
              <div className="flex items-center gap-3">
                <Switch label="Chia sẻ GPU" checked={c.shareGpu && !noGpu} disabled={noGpu} onCheckedChange={(v) => patch({ shareGpu: v })} />
                <span className="text-sm">{noGpu ? "Máy không có GPU được hỗ trợ" : c.shareGpu ? `Chia sẻ ${profile.gpu}` : "Không chia sẻ GPU"}</span>
              </div>
              <p className="text-xs text-ink-faint">Không hỗ trợ mọi GPU. Khi có phiên dùng GPU, game/ứng dụng của bạn trên Windows có thể giật.</p>
            </div>
            <fieldset className="col-span-2">
              <legend className="mb-2 text-sm font-semibold">Danh mục bài đăng</legend>
              <div className="flex gap-6">
                {(["game", "graphics", "dev"] as Category[]).map((cat) => {
                  const needsGpu = cat !== "dev";
                  const blocked = needsGpu && (noGpu || !c.shareGpu);
                  return <Checkbox key={cat} checked={c.categories.includes(cat) && !blocked} disabled={blocked} onChange={(v) => toggleCat(cat, v)} label={CATEGORY_LABEL[cat]} hint={blocked ? "Cần chia sẻ GPU" : undefined} />;
                })}
              </div>
            </fieldset>
            <Banner tone="warn" className="col-span-2" title="Ảnh hưởng tới máy của bạn">
              Bạn vẫn dùng được Windows khi có khách, nhưng nền tảng không hứa hiệu năng của bạn không bị ảnh hưởng. Chia sẻ ít hơn sẽ an toàn hơn cho công việc của bạn.
            </Banner>
          </div>
        )}

        {tab === "price" && (
          <div className="grid max-w-3xl grid-cols-2 gap-x-10">
            <div className="space-y-4">
              <Field label="Giá cho mỗi 15 phút (PCP thử)" htmlFor="price" hint="PCP thử không phải tiền thật; mức giá chỉ để minh họa.">
                <div className="flex items-center gap-3">
                  <Input id="price" type="number" min={2} max={60} value={c.pricePer15} onChange={(e) => patch({ pricePer15: Math.min(60, Math.max(2, Number(e.target.value) || 2)) })} className="w-24" />
                  <div className="flex-1"><Slider label="Giá mỗi 15 phút" value={c.pricePer15} min={2} max={60} onChange={(v) => patch({ pricePer15: v })} /></div>
                </div>
              </Field>
              {c.pricePer15 > 45 && <p className="flex items-center gap-1.5 text-xs font-semibold text-warn"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Giá cao hơn hầu hết máy trong danh sách mô phỏng (≤ 45).</p>}
            </div>
            <div>
              <p className="mb-2 text-sm font-bold">Khách trả cho 1 giờ</p>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt>Tổng khách trả (4 khung)</dt><dd><Money value={q.gross} /></dd></div>
                <div className="flex justify-between text-ink-faint"><dt>Phí nền tảng 10%</dt><dd><Money value={q.fee} /></dd></div>
                <div className="flex justify-between border-t border-line pt-1.5 font-bold"><dt>Bạn nhận</dt><dd><Money value={q.hostNet} /></dd></div>
              </dl>
              <p className="mt-2 text-xs text-ink-faint">Thu nhập chỉ được ghi nhận sau khi dọn dẹp phiên được xác nhận.</p>
            </div>
          </div>
        )}

        {tab === "weekly" && (
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_250px]">
            <WeeklyEditor weekly={c.weekly} onChange={(weekly) => patch({ weekly })} />
            <div><h3 className="mb-2 text-sm font-bold">7 ngày tới</h3><UpcomingPreview weekly={c.weekly} exceptions={c.exceptions} /></div>
          </div>
        )}

        {tab === "exceptions" && (
          <div className="space-y-6">
            <ExceptionsEditor exceptions={c.exceptions} onChange={(exceptions) => patch({ exceptions })} />
            <div className="max-w-sm"><h3 className="mb-2 text-sm font-bold">Kết quả sau ngoại lệ (7 ngày tới)</h3><UpcomingPreview weekly={c.weekly} exceptions={c.exceptions} /></div>
          </div>
        )}
      </div>
    </Tabs>
  );
}
