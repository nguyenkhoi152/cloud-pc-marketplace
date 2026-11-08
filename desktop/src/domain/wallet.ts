import type { Transaction, Wallet } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ghi giao dịch vào đúng sổ. Số dư sử dụng và thu nhập host không bao giờ cộng gộp. */
export function addTransaction(w: Wallet, tx: Transaction): Wallet {
  const next: Wallet = { ...w, transactions: [tx, ...w.transactions] };
  if (tx.ledger === "usable") next.usable = r2(w.usable + tx.amount);
  else if (tx.status === "held") next.hostHeld = r2(w.hostHeld + tx.amount);
  else next.hostSettled = r2(w.hostSettled + tx.amount);
  return next;
}

/** Cleanup xác nhận xong: chuyển thu nhập đang giữ của phiên sang đã ghi nhận. */
export function releaseHeld(w: Wallet, sessionId: string): Wallet {
  let moved = 0;
  const transactions = w.transactions.map((t) => {
    if (t.sessionId === sessionId && t.ledger === "host" && t.status === "held") {
      moved += t.amount;
      return { ...t, status: "done" as const };
    }
    return t;
  });
  return { ...w, transactions, hostHeld: r2(w.hostHeld - moved), hostSettled: r2(w.hostSettled + moved) };
}
