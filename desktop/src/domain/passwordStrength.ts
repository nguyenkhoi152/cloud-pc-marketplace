/**
 * Gợi ý độ mạnh mật khẩu cho form đăng ký (chỉ là gợi ý phía client; quy tắc bắt buộc duy nhất vẫn là tối thiểu 8 ký tự).
 * 0 = chưa đạt, 1 = đạt yêu cầu, 2 = khá, 3 = mạnh. Không gửi mật khẩu đi đâu: hàm thuần.
 */
export type PasswordStrength = { level: 0 | 1 | 2 | 3; label: string };

export const MIN_PASSWORD = 8;

const classes = (pw: string) =>
  [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;

export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return { level: 0, label: "" };
  if (pw.length < MIN_PASSWORD) return { level: 0, label: `Chưa đủ ${MIN_PASSWORD} ký tự` };
  const kinds = classes(pw);
  if (pw.length >= 12 && kinds >= 3) return { level: 3, label: "Mạnh" };
  if (pw.length >= 10 && kinds >= 2) return { level: 2, label: "Khá" };
  return { level: 1, label: "Đạt yêu cầu" };
}
