import Link from "next/link";
import { filterMachines, machineFilterSchema, pcpDecimalString, previewMachines } from "@cpm/shared";
import { Card, PageTitle, StatusPill } from "@/components/ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

export default async function CatalogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const parsed = machineFilterSchema.safeParse({
    q: first(sp.q),
    minRamGb: first(sp.minRamGb),
    minVramGb: first(sp.minVramGb),
    maxPrice: pcpDecimalString.safeParse(first(sp.maxPrice)).success ? first(sp.maxPrice) : undefined,
    os: first(sp.os),
    region: first(sp.region),
    workspaceOnly: first(sp.workspaceOnly) === "on" ? true : undefined,
  });
  const filter = parsed.success ? parsed.data : {};
  const machines = filterMachines(previewMachines.filter((m) => m.status === "approved"), filter);
  const oses = [...new Set(previewMachines.map((m) => m.os))];
  const regions = [...new Set(previewMachines.map((m) => m.region))];

  return (
    <>
      <PageTitle sub="Chỉ hiển thị máy đã duyệt. Trạng thái online chưa xác định vì chưa có heartbeat thật.">
        Tìm máy để thuê
      </PageTitle>

      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-3 text-sm">
        <label className="flex flex-col gap-1">Từ khoá
          <input name="q" defaultValue={first(sp.q)} className="rounded border px-2 py-1 text-black" />
        </label>
        <label className="flex flex-col gap-1">RAM tối thiểu (GB)
          <input name="minRamGb" type="number" min={0} defaultValue={first(sp.minRamGb)} className="rounded border px-2 py-1 text-black" />
        </label>
        <label className="flex flex-col gap-1">VRAM tối thiểu (GB)
          <input name="minVramGb" type="number" min={0} defaultValue={first(sp.minVramGb)} className="rounded border px-2 py-1 text-black" />
        </label>
        <label className="flex flex-col gap-1">Giá tối đa (PCP)
          <input name="maxPrice" type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,18})?" defaultValue={first(sp.maxPrice)} className="rounded border px-2 py-1 text-black" />
        </label>
        <label className="flex flex-col gap-1">Hệ điều hành
          <select name="os" defaultValue={first(sp.os) ?? ""} className="rounded border px-2 py-1 text-black">
            <option value="">Tất cả</option>
            {oses.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Vùng
          <select name="region" defaultValue={first(sp.region) ?? ""} className="rounded border px-2 py-1 text-black">
            <option value="">Tất cả</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input name="workspaceOnly" type="checkbox" defaultChecked={first(sp.workspaceOnly) === "on"} />
          Tương thích workspace
        </label>
        <div className="sm:col-span-2 flex gap-3 items-end">
          <button className="rounded bg-slate-800 text-white px-4 py-1.5">Lọc</button>
          <Link href="/" className="underline py-1.5">Xoá lọc</Link>
        </div>
      </form>

      {machines.length === 0 ? (
        <p>Không có máy phù hợp bộ lọc.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {machines.map((m) => (
            <li key={m.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium">{m.name}</h2>
                  <StatusPill>Minh hoạ</StatusPill>
                </div>
                <p className="text-sm opacity-80 mt-1">
                  {m.cpu} · {m.ramGb} GB RAM · {m.gpu ? `${m.gpu} ${m.vramGb} GB` : "Không GPU rời"}
                </p>
                <p className="text-sm opacity-80">{m.os} · {m.region} · {m.pricePcp} PCP / 15 phút</p>
                <Link href={`/machines/${m.id}`} className="mt-2 inline-block text-sm underline">Xem chi tiết</Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
