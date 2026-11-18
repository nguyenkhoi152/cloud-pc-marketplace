/** "Bản thử này gồm gì": phần nào thật (dev), phần nào GIẢ LẬP, phần nào chưa kết nối — suy từ cấu hình thật của bản build. */
import { envFacts } from "@/api/envFacts";
import { describeEnv, ENV_KIND_LABEL, type EnvKind } from "@/domain/envLabels";
import { Badge, type Tone } from "@/ui/badge";
import { Banner } from "@/ui/feedback";
import { PageHeader } from "@/ui/page";

const TONE: Record<EnvKind, Tone> = { "real-dev": "info", simulated: "warn", "not-connected": "neutral", untested: "teal" };

export function About() {
  const env = describeEnv(envFacts());
  return (
    <div>
      <PageHeader title="Bản thử này gồm gì" subtitle="Đây là bản demo để cài và trình bày, chưa phải dịch vụ công khai. Bảng dưới nói rõ từng phần đang nối với cái gì." />
      <Banner tone="warn" title="Không có tiền thật trong bản này">
        PCP là điểm thử. Không mua, bán, rút hay đổi ra tiền được. Đừng đưa dữ liệu nhạy cảm vào máy thuê.
      </Banner>
      <table className="mt-4 w-full border-collapse text-sm" data-testid="env-table">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
            <th className="py-2 pr-4 font-bold">Phần</th>
            <th className="py-2 pr-4 font-bold">Hiện trạng</th>
            <th className="py-2 font-bold">Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {env.rows.map((r) => (
            <tr key={r.key} data-env={r.key} data-kind={r.kind} className="border-b border-line align-top">
              <td className="py-2.5 pr-4 font-semibold">{r.what}</td>
              <td className="py-2.5 pr-4">
                <Badge tone={TONE[r.kind]}>{ENV_KIND_LABEL[r.kind]}</Badge>
                <p className="mt-1 text-xs font-semibold">{r.label}</p>
              </td>
              <td className="py-2.5 text-ink-soft">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
