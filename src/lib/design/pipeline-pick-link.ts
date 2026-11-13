// The pipeline and account a person picked on Pipeline, as plain words in the address (so a pasted link or a saved view shows the same deals) and as a tail for the older screens' requests.
// Pure and unit tested. In the address they are `pp` (pipeline name) and `pa` (account id) after the `?` of the hash; everything else in the hash is left alone.

export type PipelinePick = { pipeline: string; location: string };
const ACCOUNT = /^[A-Za-z0-9_-]{3,64}$/;
const cleanName = (v: string | null | undefined) => (v ?? "").trim().slice(0, 120);

/** What a hash like `#pipeline?pp=Sales%20Pipeline&pa=abc123&r.page=30d` asks for. Anything else is empty (= "All pipelines", all accounts). */
export function pickFromHash(hash: string): PipelinePick {
  const q = hash.indexOf("?");
  if (q === -1) return { pipeline: "", location: "" };
  const p = new URLSearchParams(hash.slice(q + 1)), acct = p.get("pa") ?? "";
  return { pipeline: cleanName(p.get("pp")), location: ACCOUNT.test(acct) ? acct : "" };
}

/** The hash with the pick written in (or taken out when it is "All pipelines" and all accounts). Every other part of the hash is kept as it was. */
export function hashWithPick(hash: string, pick: PipelinePick): string {
  const q = hash.indexOf("?"), head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  p.delete("pp"); p.delete("pa");
  if (cleanName(pick.pipeline)) p.set("pp", cleanName(pick.pipeline));
  if (ACCOUNT.test(pick.location)) p.set("pa", pick.location);
  const rest = p.toString();
  return rest ? `${head}?${rest}` : head;
}

/** `path` with `pipeline=` and `location=` added for the screens that read them (stale deals, hygiene, the older pipeline views, exports). Nothing picked = the path unchanged. */
export function pickPath(path: string, pick: Partial<PipelinePick> | null | undefined): string {
  const p = new URLSearchParams();
  if (pick?.pipeline?.trim()) p.set("pipeline", cleanName(pick.pipeline));
  if (pick?.location) p.set("location", pick.location);
  const tail = p.toString();
  if (!tail) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${tail}`;
}
