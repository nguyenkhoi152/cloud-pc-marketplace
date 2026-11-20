/**
 * Rút gọn số PCP dài để hiển thị trong ô số liệu (đơn vị gốc có tới 18 chữ số lẻ, ví dụ "12.34567890123456789").
 * Cắt bớt, KHÔNG làm tròn lên (không bao giờ hiển thị nhiều hơn số thật), thêm "≈" khi có cắt; giá trị đầy đủ trả về trong `exact`
 * để đặt vào `title`. Đầu vào là chuỗi thập phân đã định dạng bởi `formatUnits`.
 */
export interface ShortUnits {
  text: string;
  exact: string;
  truncated: boolean;
}

export function shortUnits(value: string, maxDecimals = 4): ShortUnits {
  const [whole = "0", frac = ""] = value.split(".");
  if (frac.length <= maxDecimals) return { text: value, exact: value, truncated: false };
  const kept = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return { text: `≈ ${kept ? `${whole}.${kept}` : whole}`, exact: value, truncated: true };
}
