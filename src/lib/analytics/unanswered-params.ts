// What a list of people on the Unanswered screen is asked for, checked and clamped. Pure (no database), so it is unit tested. The server never trusts a value from the address:
// ids must look like ids, choices must be from the fixed lists, sizes are 20, 50 or 100 and a page is never negative. The account ids only NARROW inside the accounts the
// verified session may read; that is decided by the caller, not here.

export const LIST_SIZES = [20, 50, 100] as const;
export const LIST_SORTS = ["wait", "newest", "name", "account", "value"] as const;
export const VALUE_STEPS = [0, 500, 1000, 5000, 10000] as const;
export const QUIET_HOURS = [4, 24, 72] as const;
export const TABS = ["us", "them"] as const;
export const STATES = ["active", "snoozed", "hidden"] as const;
export const OWNER_CHOICES = ["me", "none", "mine_free"] as const;
export const BUCKET_CHOICES = ["h1", "h4", "h24", "h48"] as const;

export type ListTab = (typeof TABS)[number];
export type ListSort = (typeof LIST_SORTS)[number];
export type ListState = (typeof STATES)[number];

export type ListParams = {
  tab: ListTab; q: string; account: string | null; owner: string | null; channel: string | null; bucket: (typeof BUCKET_CHOICES)[number] | null;
  minValue: number; state: ListState; sort: ListSort; page: number; size: (typeof LIST_SIZES)[number]; quiet: (typeof QUIET_HOURS)[number];
};

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const CHANNEL = /^[A-Za-z0-9 .&'-]{1,40}$/;
const num = (v: string | null, d: number) => { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) ? Math.floor(n) : d; };
function pick<T extends string | number>(list: readonly T[], v: string | null, d: T): T | null {
  if (v === null || v === "") return d;
  const hit = list.find((x) => String(x) === v);
  return hit === undefined ? null : hit;
}

/** Reads the address. `seePeople` is false for a client's staff: they may only narrow to "mine", "no owner" and "mine and unassigned", never to a colleague. */
export function readListParams(sp: URLSearchParams, o: { seePeople: boolean }): { ok: true; p: ListParams } | { ok: false; error: string } {
  const tab = pick(TABS, sp.get("tab"), "us"); if (tab === null) return { ok: false, error: "Unknown tab" };
  const sort = pick(LIST_SORTS, sp.get("sort"), "wait"); if (sort === null) return { ok: false, error: "Unknown sort" };
  const state = pick(STATES, sp.get("state"), "active"); if (state === null) return { ok: false, error: "Unknown state" };
  const size = pick(LIST_SIZES, sp.get("size"), 20); if (size === null) return { ok: false, error: "Unknown page size" };
  const quiet = pick(QUIET_HOURS, sp.get("quiet"), 24); if (quiet === null) return { ok: false, error: "Unknown quiet time" };
  const minValue = pick(VALUE_STEPS, sp.get("minValue"), 0); if (minValue === null) return { ok: false, error: "Unknown deal value" };
  const bucketP = sp.get("bucket");
  if (bucketP && bucketP !== "all" && !(BUCKET_CHOICES as readonly string[]).includes(bucketP)) return { ok: false, error: "Unknown wait" };
  const channel = sp.get("channel");
  if (channel && !CHANNEL.test(channel)) return { ok: false, error: "Unknown channel" };
  const account = sp.get("account");
  if (account && !ID.test(account)) return { ok: false, error: "Unknown account" };
  const owner = sp.get("owner");
  if (owner && !(OWNER_CHOICES as readonly string[]).includes(owner) && !(o.seePeople && ID.test(owner))) return { ok: false, error: "Unknown owner" };
  return {
    ok: true,
    p: {
      tab, sort, state, size, quiet, minValue, account: account || null, owner: owner || null, channel: channel || null,
      bucket: bucketP && bucketP !== "all" ? (bucketP as ListParams["bucket"]) : null,
      q: (sp.get("q") ?? "").trim().slice(0, 80), page: Math.max(0, Math.min(num(sp.get("page"), 0), 100_000)),
    },
  };
}

/** `%` and `_` typed by a person are letters, not wildcards. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The words of a search, lower case, each at most 40 characters, at most 6 of them. A word of 3 or more digits also searches phone numbers. */
export function searchTerms(q: string): Array<{ like: string; digits: string | null }> {
  return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6).map((w) => {
    const word = w.slice(0, 40);
    const digits = word.replace(/\D/g, "");
    return { like: `%${escapeLike(word)}%`, digits: digits.length >= 3 ? digits : null };
  });
}

const KEYS_BY_LABEL: Record<string, string[]> = {
  "text message": ["sms"], email: ["email"], whatsapp: ["whatsapp"], facebook: ["fb", "facebook"], instagram: ["ig", "instagram"], "google business": ["gmb"],
  "live chat": ["live_chat", "livechat", "webchat"], call: ["call"], other: ["custom"], review: ["sms_review"],
};
/** The platform's message types behind a channel in words ("Text message" is "sms"). An unknown label maps to its own spelling. */
export function channelKeys(label: string): string[] {
  const l = label.trim().toLowerCase();
  return KEYS_BY_LABEL[l] ?? [l.replace(/ /g, "_")];
}

/** The state of a list as a short address (shared and saved views). Only non-default choices are written, so the address stays short. */
export function toQuery(p: Partial<ListParams>): string {
  const sp = new URLSearchParams();
  const put = (k: string, v: unknown, d: unknown = null) => { if (v !== undefined && v !== null && v !== "" && v !== d) sp.set(k, String(v)); };
  put("tab", p.tab, "us"); put("q", p.q); put("account", p.account); put("owner", p.owner); put("channel", p.channel); put("bucket", p.bucket);
  put("minValue", p.minValue, 0); put("state", p.state, "active"); put("sort", p.sort, "wait"); put("size", p.size, 20); put("quiet", p.quiet, 24);
  return sp.toString();
}

/** The choices of a saved view, cleaned: only known keys and values survive, so a stored view can never carry anything else. No customer data is kept in it. */
export function cleanView(raw: unknown, o: { seePeople: boolean }): Partial<ListParams> {
  if (!raw || typeof raw !== "object") return {};
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" || typeof v === "number") sp.set(k, String(v));
  sp.delete("page");
  const r = readListParams(sp, o);
  if (!r.ok) return {};
  const { page: _page, ...rest } = r.p;
  void _page;
  return rest;
}
