// Anything that reaches a log or is stored as an error goes through here first. A database or platform error message
// can carry row values ("Key (email)=(a@b.c) already exists"), addresses, numbers or tokens; none of that may be written down.
const MAX = 300;

export function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return String(error.message ?? "")
    .replace(/Key \([^)]*\)=\([^)]*\)/g, "Key (…)=(…)")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer …")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "…@…")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "…")
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "…")
    .slice(0, MAX);
}
