// Client-safe money text (no Node imports), shared by the screens and payments-logic.ts.
export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return "Not available";
  const c = (currency ?? "").toUpperCase();
  try { if (c.length === 3) return new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount); } catch { /* unknown code */ }
  return `${amount.toLocaleString("en-US")}${c ? " " + c : ""}`;
}
