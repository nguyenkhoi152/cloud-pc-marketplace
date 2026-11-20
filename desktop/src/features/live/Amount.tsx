import { shortUnits } from "@/domain/displayUnits";
import { formatUnits } from "@/api/live";
import { cn } from "@/lib/utils";

/**
 * Số lượng (đơn vị gốc dạng chuỗi) hiển thị gọn trong ô số liệu hoặc dòng danh sách; giá trị đầy đủ nằm ở `title` khi có rút gọn.
 * KHÔNG dùng ở màn trả tiền/báo giá: ở đó phải hiện chính xác tuyệt đối trước khi người dùng ký.
 * `inline`: dùng trong một dòng chữ (đơn vị thừa hưởng cỡ chữ của dòng thay vì nhỏ và xám như ở ô số liệu).
 */
export function Amount({ units, suffix, testId, inline }: { units: string | bigint; suffix: string; testId?: string; inline?: boolean }) {
  const s = shortUnits(formatUnits(units));
  return (
    <span data-testid={testId} title={s.truncated ? `${s.exact} ${suffix}` : undefined}>
      <span className="num">{s.text}</span> <span className={cn(!inline && "text-sm font-medium text-ink-faint")}>{suffix}</span>
    </span>
  );
}
