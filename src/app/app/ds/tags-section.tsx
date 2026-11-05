"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { filterTags, highlight, type TagOption } from "@/lib/people/tag-list";
import { tagColor } from "@/lib/people/tag-colors";
import { useApiClient } from "../session";
import { InfoTip } from "./info-tip";

// The Tags section of the contact panel: all the account's tags to pick from (read from the CRM), a colour per tag, add with a searchable picker, remove after a plain confirmation.
// Add and remove change the tag on the contact in the CRM (the server does the write, behind the live switch). Everything explanatory is in the "i" tooltip.

type Reply = { ok: boolean; status: string; message: string; id?: string; canUndo?: boolean; duplicate?: boolean };
type TagList = { tags: TagOption[]; source: "crm" | "contacts"; needsPermission: boolean };
const ROW = 36, VIEW = 8;

const styleOf = (name: string): CSSProperties => {
  const c = tagColor(name);
  return { "--tg-bg-l": c.light.bg, "--tg-fg-l": c.light.fg, "--tg-dot-l": c.light.dot, "--tg-bg-d": c.dark.bg, "--tg-fg-d": c.dark.fg, "--tg-dot-d": c.dark.dot } as CSSProperties;
};
const dayText = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString("en-GB", d.getFullYear() === new Date().getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }); };
const recentKey = (loc: string) => `subsync.recentTags.${loc}`;
const readRecent = (loc: string): string[] => { try { return JSON.parse(localStorage.getItem(recentKey(loc)) ?? "[]") as string[]; } catch { return []; } };
const writeRecent = (loc: string, name: string) => { try { localStorage.setItem(recentKey(loc), JSON.stringify([name, ...readRecent(loc).filter((t) => t.toLowerCase() !== name.toLowerCase())].slice(0, 8))); } catch { /* private window */ } };

export const DATE_TIP = "Your CRM does not keep the date a tag was added. SubSync remembers the date it first saw or applied the tag. Tags you add or remove here are changed in your CRM too.";

export function Dot({ name }: { name: string }) { return <span aria-hidden style={styleOf(name)} className="tag-dot inline-block size-2.5 shrink-0 rounded-full" />; }

export function TagsSection({ locationId, contactId, name, tags, tagDates, tagExact }: { locationId: string; contactId: string; name: string; tags: string[]; tagDates: Record<string, string>; tagExact: Record<string, boolean> }) {
  const api = useApiClient();
  const [list, setList] = useState(tags);
  const [dates, setDates] = useState<Record<string, { at: string; exact: boolean }>>({});
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [pool, setPool] = useState<TagList | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean; undo?: { id: string; tag: string; remove: boolean } } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const f = useMemo(() => filterTags(pool?.tags ?? [], q, list, open ? readRecent(locationId) : []), [pool, q, list, open, locationId]);
  const rows = useMemo(() => [...f.options.map((o) => ({ kind: "tag" as const, o })), ...(f.canCreate ? [{ kind: "create" as const, o: { name: q.trim().replace(/\s+/g, " "), count: 0 } }] : [])], [f, q]);

  useEffect(() => { setActive(0); setScroll(0); }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const openPicker = async () => {
    setOpen(true); setQ("");
    setTimeout(() => input.current?.focus(), 0);
    if (!pool) { try { setPool(await api.get<TagList>(`people/tags?locationId=${encodeURIComponent(locationId)}`)); } catch { setPool({ tags: [], source: "contacts", needsPermission: false }); } }
  };
  const send = async (tag: string, remove: boolean) => {
    setBusy(true);
    try {
      const r = await api.post<Reply>("people/tag", { locationId, contactId, tag, remove, confirm: remove });
      const text = r.status === "saved" && !r.duplicate ? `Tag ‘${tag}’ ${remove ? "removed from" : "added to"} ${name} in your CRM.` : r.message;
      setMsg({ text, ok: r.ok, undo: r.canUndo && r.id ? { id: r.id, tag, remove } : undefined });
      if (r.ok && r.status === "saved") {
        if (remove) setList((l) => l.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
        else { setList((l) => (l.some((t) => t.toLowerCase() === tag.toLowerCase()) ? l : [...l, tag])); setDates((d) => ({ ...d, [tag]: { at: new Date().toISOString(), exact: true } })); writeRecent(locationId, tag); }
      }
      return r.ok;
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }); return false; } finally { setBusy(false); }
  };
  const pick = async (tag: string) => { if (busy || !tag) return; if (await send(tag, false)) { setOpen(false); setQ(""); } };
  const undo = async () => {
    const u = msg?.undo; if (!u) return;
    setBusy(true);
    try {
      const r = await api.post<Reply>("people/write-undo", { id: u.id });
      setMsg({ text: r.ok ? (u.remove ? `Tag ‘${u.tag}’ is back on ${name} in your CRM.` : `Tag ‘${u.tag}’ removed again from ${name} in your CRM.`) : r.message, ok: r.ok });
      if (r.ok) setList((l) => (u.remove ? [...l, u.tag] : l.filter((t) => t.toLowerCase() !== u.tag.toLowerCase())));
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }); } finally { setBusy(false); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => { const n = Math.min(rows.length - 1, a + 1); if (n * ROW >= scroll + VIEW * ROW) setScroll((n - VIEW + 1) * ROW); return n; }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => { const n = Math.max(0, a - 1); if (n * ROW < scroll) setScroll(n * ROW); return n; }); }
    else if (e.key === "Enter") { e.preventDefault(); const r = rows[active] ?? (q.trim() ? { o: { name: q.trim() } } : null); if (r) void pick(r.o.name); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };
  const first = Math.max(0, Math.floor(scroll / ROW) - 2), last = Math.min(rows.length, first + VIEW + 5);

  return (
    <section className="mt-4 rounded-lg border bg-card p-3" aria-label="Tags" data-testid="drawer-tags">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Tags</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums" data-testid="tags-count" aria-label={`${list.length} tags`}>{list.length}</span>
        <InfoTip text={DATE_TIP} label="About tag dates" testId="tags-info" />
        <div className="relative ml-auto" ref={box}>
          <button type="button" onClick={() => void openPicker()} aria-haspopup="listbox" aria-expanded={open} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="tag-add">+ Add tag</button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-72 max-w-[85vw] rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl" data-testid="tag-picker">
              <input ref={input} role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined} aria-autocomplete="list" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} maxLength={60} placeholder="Search or create a tag" aria-label="Search or create a tag" className="h-9 w-full rounded-md border bg-background px-2.5 text-sm" data-testid="tag-input" />
              <div id={listId} role="listbox" aria-label="Tags" onScroll={(e) => setScroll((e.target as HTMLElement).scrollTop)} className="mt-1.5 overflow-y-auto" style={{ maxHeight: VIEW * ROW }} data-testid="tag-options">
                {!pool ? <p className="px-2 py-2 text-sm text-muted-foreground">Loading tags...</p> : rows.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">No tags yet. Type a name to create one.</p> : (
                  <div style={{ height: rows.length * ROW, position: "relative" }}>
                    {rows.slice(first, last).map((r, k) => {
                      const i = first + k;
                      return (
                        <div key={r.kind + r.o.name} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => void pick(r.o.name)}
                          style={{ position: "absolute", top: i * ROW, height: ROW, left: 0, right: 0 }} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 text-sm ${i === active ? "bg-accent" : ""}`} data-testid={r.kind === "create" ? "tag-create" : "tag-option"}>
                          <Dot name={r.o.name} />
                          {r.kind === "create" ? <span className="truncate">Create tag &lsquo;<b>{r.o.name}</b>&rsquo;</span> : <span className="truncate">{highlight(r.o.name, q).map((p, n) => p.hit ? <mark key={n} className="rounded-sm bg-primary/25 px-0.5 text-inherit">{p.text}</mark> : <span key={n}>{p.text}</span>)}</span>}
                          {r.kind === "tag" && r.o.count > 0 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{r.o.count}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {pool?.needsPermission && <p className="mt-1.5 border-t px-1 pt-1.5 text-xs text-muted-foreground" data-testid="tags-needs-permission">Needs permission: reconnect to see all the tags in your CRM. Showing tags found on contacts.</p>}
            </div>
          )}
        </div>
      </div>
      {list.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No tags on this contact yet.</p> : (
        <ul className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="tag-chips">
          {list.slice(0, 40).map((t) => {
            const d = dates[t] ?? (tagDates[t] ? { at: tagDates[t], exact: tagExact[t] === true } : null);
            return (
              <li key={t} style={styleOf(t)} className="tag-pill group/chip inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 text-xs font-semibold" data-testid="drawer-tag">
                <span>{t}</span>
                {d && <span className="font-normal opacity-80" title={d.exact ? "Added here, at this exact time" : "The day SubSync first saw this tag"} data-testid="tag-date">{dayText(d.at)}</span>}
                <button type="button" aria-label={`Remove the tag ${t}`} disabled={busy} onClick={() => setConfirming(t)} className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full opacity-60 hover:bg-black/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)] group-hover/chip:opacity-100 disabled:cursor-not-allowed dark:hover:bg-white/15" data-testid="tag-remove">&times;</button>
              </li>
            );
          })}
        </ul>
      )}
      {confirming && (
        <div className="mt-2.5 rounded-lg border bg-popover p-3 text-sm shadow-md" role="alertdialog" aria-label="Remove tag" data-testid="tag-confirm">
          <p>Remove the tag &lsquo;{confirming}&rsquo; from {name} in your CRM? This changes your CRM.</p>
          <p className="mt-2 flex gap-2">
            <button type="button" onClick={() => { const t = confirming; setConfirming(null); void send(t, true); }} className="min-h-9 cursor-pointer rounded-md bg-destructive px-3 font-semibold text-white hover:opacity-90" data-testid="tag-confirm-remove">Remove</button>
            <button type="button" onClick={() => setConfirming(null)} autoFocus className="min-h-9 cursor-pointer rounded-md border bg-card px-3 font-medium hover:bg-accent" data-testid="tag-confirm-cancel">Cancel</button>
          </p>
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-muted-foreground" : "font-medium text-destructive"}`} role="status" data-testid="tag-status">{msg.text}{msg.undo && <button type="button" disabled={busy} onClick={() => void undo()} className="ml-2 min-h-9 cursor-pointer font-medium underline" data-testid="tag-undo">Undo</button>}</p>}
    </section>
  );
}
