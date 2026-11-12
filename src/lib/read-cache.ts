import { ttlCache } from "./ttl-cache";

// Round 4 speed: every screen read used to start with the same handful of small database reads (which installation, which settings, which accounts) and then do its own work.
// Each of those costs one trip to the database. This keeps the small, rarely-changing ones for a few seconds per server instance, and shares a read that is already on its way, so two
// screens asking for the same thing at the same moment cause one trip. Any change (POST, PUT, DELETE) forgets everything held for the installation first (see router.handle), so a
// person who saves a setting and reloads never sees the old value on that instance. Never used for anything that must be fresh to the second.

const SMALL = ttlCache<unknown>(10_000, 500);
const inflight = new Map<string, Promise<unknown>>();

/** Off in tests, in demo mode and when DISABLE_READ_CACHE is set (the check scripts change rows directly and read straight after); READ_CACHE=on forces it on (profiling). */
export function readCacheOn(env: Record<string, string | undefined> = process.env): boolean {
  if (env.READ_CACHE === "on") return true;
  return !(env.DISABLE_READ_CACHE || env.DEMO_MODE === "true" || env.NODE_ENV === "test" || env.VITEST);
}

/** Run `load` at most once per 10 s for this key; concurrent callers share one run. A failed load is never kept. `scope` (an installation id or company key) lets a change drop its entries. */
export async function cachedRead<T>(scope: string, key: string, load: () => Promise<T>): Promise<T> {
  if (!readCacheOn()) return load();
  const k = `${scope}|${key}`;
  const hit = SMALL.get(k);
  if (hit !== undefined) return hit as T;
  const running = inflight.get(k);
  if (running) return running as Promise<T>;
  // A "nothing found" answer (null) is never kept: right after an install or a first save the next read must see the new row.
  const p = load().then((v) => { if (v !== null && v !== undefined) SMALL.set(k, v); return v; });
  inflight.set(k, p);
  const done = () => { if (inflight.get(k) === p) inflight.delete(k); };
  p.then(done, done);
  return p;
}

/** Forget what is held for one scope (an installation id or a company key). */
export function forgetScope(scope: string): void { SMALL.clear(`${scope}|`); for (const k of [...inflight.keys()]) if (k.startsWith(`${scope}|`)) inflight.delete(k); }
/** Forget everything (a plan change or a flag change on this instance). */
export function forgetAllReads(): void { SMALL.clear(""); inflight.clear(); }

// The finished answer of a heavy read (Speed to lead, Appointments): the JSON text and status, kept for a short time per installation + who is asking + the exact address.
// A repeated click, or a second person of the same company on the same screen, gets the stored answer at once.
type Stored = { status: number; body: string };
const ANSWERS = ttlCache<Stored>(30_000, 300);
const answersInflight = new Map<string, Promise<Stored>>();

export function answerKey(installationId: string, who: string, url: string): string { return `${installationId}|${who}|${url}`; }

/** The stored answer for a read, or run `make` once (shared with anyone asking for the same key meanwhile). Only a 200 is kept. */
export async function cachedAnswer(key: string, make: () => Promise<Stored>): Promise<Stored> {
  if (!readCacheOn()) return make();
  const hit = ANSWERS.get(key);
  if (hit) return hit;
  const running = answersInflight.get(key);
  if (running) return running;
  const p = make().then((v) => { if (v.status === 200) ANSWERS.set(key, v); return v; });
  answersInflight.set(key, p);
  const done = () => { if (answersInflight.get(key) === p) answersInflight.delete(key); };
  p.then(done, done);
  return p;
}

export function forgetAnswers(installationId: string): void { ANSWERS.clear(`${installationId}|`); for (const k of [...answersInflight.keys()]) if (k.startsWith(`${installationId}|`)) answersInflight.delete(k); }
