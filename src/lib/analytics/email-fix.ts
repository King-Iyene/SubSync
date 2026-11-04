// Email shape and the typo fixer, shared by data quality and the clean-up planner. Pure.

export const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;.]{2,}$/;
const clean = (s: string | null | undefined) => (s ?? "").trim();

const DOMAIN_TYPO: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmal.com": "hotmail.com", "hotmil.com": "hotmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "yhoo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com", "outloo.com": "outlook.com", "iclould.com": "icloud.com", "icloud.con": "icloud.com", "icoud.com": "icloud.com",
  "aol.con": "aol.com", "comcast.nt": "comcast.net", "comcast.con": "comcast.net", "msn.con": "msn.com", "live.con": "live.com",
};
const TLD_TYPO: Record<string, string> = { con: "com", cmo: "com", vom: "com", ocm: "com", cim: "com", xom: "com", comm: "com" };

/** The corrected email when its domain has a known typo (gmial.com, name@gmail.con), otherwise null. */
export function emailFix(email: string | null | undefined): string | null {
  const e = clean(email);
  if (!EMAIL_SHAPE.test(e)) return null;
  const at = e.lastIndexOf("@");
  const d = e.slice(at + 1).toLowerCase();
  if (DOMAIN_TYPO[d]) return `${e.slice(0, at)}@${DOMAIN_TYPO[d]}`;
  const dot = d.lastIndexOf(".");
  const tld = d.slice(dot + 1);
  if (TLD_TYPO[tld]) return `${e.slice(0, at)}@${d.slice(0, dot + 1)}${TLD_TYPO[tld]}`;
  return null;
}

