"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InlineAlert, Section, SkeletonRows, ErrorState } from "../ds";
import { useApiClient, useData } from "../session";
import { Badge, Btn, inputClass } from "../ui";
import { ITEMS, matrixFor, type Item, type ItemDestination, type LockInfo, type Matrix, type PolicyFlags, type Preset } from "@/lib/connections/policy";

// Meeting notes settings (stage E2b): what a person saves and where (the table, the layouts, the text layout with a live preview), and what an admin sets
// for the whole account (what the team may use, the default layout, the locks, which contact fields are filled). A locked setting shows its value and
// one plain line: "Set by your admin." Words are the product's own: no platform or internal names.

type Option = { value: ItemDestination; label: string; disabled: boolean; why: string | null };
type Section_ = { label: string; parts: string[] };
type FieldRow = { item: string; label: string; status: "write" | "cut" | "skip"; text: string };
type Preview = { ok: true; sections: Section_[]; fields: FieldRow[]; remarks: string[]; clips: string[] } | { ok: false; problems: string[] };

export type SetupData = {
  demo: boolean; canWrite: boolean; canComment: boolean; writeLive: boolean; moreTools: boolean;
  presets: ReadonlyArray<{ id: Preset; label: string; blurb: string }>;
  items: Array<{ item: Item; label: string }>;
  variables: string[]; defaultTemplate: string; maxTemplate: number;
  mine: { preset: Preset; chosen?: boolean; custom: Matrix; template: string | null; unmatchedMode: "inbox" | "discard"; sourcePriority: string[]; masterSwitch?: boolean };
  locked: LockInfo; options: Record<Item, Option[]>; allowTranscripts: boolean; accountRules?: string | null;
  admin: { can: boolean; accounts: Array<{ locationId: string; name: string }>; canSetCompany: boolean; ownAccount?: string | null; company?: PolicyFlags | null; companySaved?: boolean };
};

const LOCKED_LINE = "Set by your admin.";
/** A tool's name from its id ("google_meet" becomes "Google Meet"). The list only ever holds the tools the account can use. */
const toolName = (id: string) => (id === "fathom" ? "Fathom" : id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));

// ---------------- the person's own choices ----------------

export function MyMeetingSetup({ data, loading, error, reload }: { data: SetupData | null; loading: boolean; error: Error | null; reload: () => Promise<void> }) {
  if (loading && !data) return <SkeletonRows rows={5} label="Loading your meeting note choices" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  return <MineForm key={JSON.stringify([data.mine.preset, data.mine.template, data.locked])} data={data} reload={reload} />;
}

function MineForm({ data, reload }: { data: SetupData; reload: () => Promise<void> }) {
  const api = useApiClient();
  const [preset, setPreset] = useState<Preset>(data.mine.preset);
  const [custom, setCustom] = useState<Matrix>(data.mine.custom);
  const [template, setTemplate] = useState(data.mine.template ?? "");
  const [order, setOrder] = useState<string[]>(data.mine.sourcePriority);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  const shown: Matrix = preset === "custom" ? custom : matrixFor(preset, null);
  const editable = preset === "custom" && !data.locked.preset && !data.locked.destinations;
  const usingTemplate = preset === "custom" && template.trim() !== "";

  // The live preview: asked again a moment after any change, so it always shows what would really be written under the account's rules.
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<Preview>("meeting-setup/preview", { preset, custom, template: usingTemplate ? template : null }).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [api, preset, custom, template, usingTemplate]);

  const save = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (!data.locked.preset && preset !== data.mine.preset) body.preset = preset;
      if (preset === "custom" && !data.locked.preset && !data.locked.destinations) { body.custom = custom; body.template = template; }
      if (!data.locked.sourcePriority && data.moreTools) body.sourcePriority = order;
      if (Object.keys(body).length === 0) { setMsg({ ok: true, text: "Nothing to change." }); return; }
      await api.put("meeting-setup/mine", body);
      await reload();
      setMsg({ ok: true, text: "Saved." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }, [api, data, preset, custom, template, order, reload]);

  const insert = (name: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : template.length;
    setTemplate(template.slice(0, at) + `{${name}}` + template.slice(at));
    requestAnimationFrame(() => el?.focus());
  };

  const problem = preview && !preview.ok ? preview.problems : null;

  return (
    <div data-testid="meeting-setup-mine">
      {!data.demo && !data.canWrite && <InlineAlert tone="warning" title="Needs permission: reconnect">SubSync cannot add notes to contacts yet. Your choices are saved, but nothing is written until the permission is granted.</InlineAlert>}
      {msg && <div className="my-3"><InlineAlert tone={msg.ok ? "success" : "danger"} onDismiss={() => setMsg(null)}>{msg.text}</InlineAlert></div>}
      {data.accountRules && <p className="mb-3 text-sm text-muted-foreground">{data.accountRules}</p>}

      <Section title="Pick a layout" hint="Four ready-made ways to save a call. You can change this any time." id="presets">
        {data.locked.preset && <p className="mb-2 text-sm" data-testid="locked-preset"><Badge tone="info">Locked</Badge> {LOCKED_LINE} Everyone on this account uses the same layout.</p>}
        <div role="radiogroup" aria-label="Layout" className="space-y-2">
          {data.presets.map((p) => {
            const blocked = data.locked.preset || (p.id === "custom" && data.locked.destinations) || (p.id === "full_record" && !data.allowTranscripts);
            const why = data.locked.preset ? LOCKED_LINE : p.id === "custom" && data.locked.destinations ? `${LOCKED_LINE} Pick one of the ready-made layouts.` : p.id === "full_record" && !data.allowTranscripts ? "Your admin has not allowed transcripts in the CRM, so the transcript part is left out." : null;
            return (
              <label key={p.id} className={`flex items-start gap-3 py-1 ${data.locked.preset || (p.id === "custom" && data.locked.destinations) ? "opacity-70" : ""}`}>
                <input type="radio" name="preset" className="mt-1" checked={preset === p.id} disabled={data.locked.preset || (p.id === "custom" && data.locked.destinations)} onChange={() => setPreset(p.id)} />
                <span className="text-sm"><span className="font-medium">{p.label}</span> <span className="text-muted-foreground">{p.blurb}</span>{blocked && why && <span className="block text-xs text-muted-foreground">{why}</span>}</span>
              </label>
            );
          })}
        </div>
      </Section>

      <Section title="What to save and where" hint={editable ? "Choose a place for each item." : preset === "custom" ? LOCKED_LINE : "This is what the layout above does. Choose Custom to change it."} id="table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="where-table">
            <caption className="sr-only">Where each part of a call is saved</caption>
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Item</th><th scope="col" className="py-2 font-medium">Saved to</th></tr></thead>
            <tbody>
              {ITEMS.map((item) => {
                const options = data.options[item];
                const current = shown[item];
                const why = options.find((o) => o.value === current)?.why ?? null;
                return (
                  <tr key={item} className="border-b align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{data.items.find((i) => i.item === item)?.label ?? item}</th>
                    <td className="py-2">
                      <select aria-label={`Where to save ${data.items.find((i) => i.item === item)?.label ?? item}`} className={inputClass + " max-w-xs"} value={current} disabled={!editable} onChange={(e) => setCustom({ ...custom, [item]: e.target.value as ItemDestination })}>
                        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled && o.value !== current} title={o.why ?? undefined}>{o.label}{o.disabled ? " (not available)" : ""}</option>)}
                      </select>
                      {why && <p className="mt-1 text-xs text-muted-foreground">{why} It is kept in SubSync only.</p>}
                      {!why && current === "field" && <p className="mt-1 text-xs text-muted-foreground">Updates the contact field your admin chose. It holds one current value, so the newest call wins.</p>}
                      {item === "transcript" && current === "off" && <p className="mt-1 text-xs text-muted-foreground">Not saved. A transcript is only written if you turn it on and your admin allows it.</p>}
                      {item === "transcript" && (current === "note" || current === "comment") && <p className="mt-1 text-xs text-muted-foreground">SubSync never stores a transcript. A long one is saved as a link. If you turn this on after connecting Fathom, reconnect it once so Fathom sends it.</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {preset === "custom" && (
        <Section title="Your own layout" hint="Optional. Write the note the way you like. Leave it empty to use the standard layout." id="layout">
          {data.locked.preset || data.locked.destinations ? <p className="text-sm text-muted-foreground">{LOCKED_LINE}</p> : (
            <>
              <textarea ref={area} aria-label="Layout text" className={inputClass + " h-40 font-mono text-xs"} value={template} maxLength={data.maxTemplate} placeholder={data.defaultTemplate} onChange={(e) => setTemplate(e.target.value)} />
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>Add:</span>
                {data.variables.map((v) => <button key={v} type="button" className="rounded border px-1.5 py-0.5 font-mono hover:bg-muted" onClick={() => insert(v)}>{`{${v}}`}</button>)}
              </div>
              <div className="mt-2 flex gap-2"><Btn variant="ghost" onClick={() => setTemplate("")}>Use the standard layout</Btn></div>
              {problem && <div className="mt-2" data-testid="layout-problems"><InlineAlert tone="danger" title="This layout cannot be saved yet">{problem.map((p) => <span key={p} className="block">{p}</span>)}</InlineAlert></div>}
            </>
          )}
        </Section>
      )}

      {data.moreTools && (
        <Section title="If two tools recorded the same meeting" hint={data.locked.sourcePriority ? LOCKED_LINE : "The first tool in the list is used. The other copy is not added again."} id="sources">
          <ol className="space-y-1 text-sm">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2"><span className="w-5 text-muted-foreground">{i + 1}.</span><span>{toolName(id)}</span>
                {!data.locked.sourcePriority && <>
                  <Btn variant="ghost" disabled={i === 0} onClick={() => setOrder(order.map((x, j) => (j === i - 1 ? order[i] : j === i ? order[i - 1] : x)))}>Up</Btn>
                  <Btn variant="ghost" disabled={i === order.length - 1} onClick={() => setOrder(order.map((x, j) => (j === i + 1 ? order[i] : j === i ? order[i + 1] : x)))}>Down</Btn>
                </>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="What will happen" hint="A made-up sample call, written the way your choices and your admin's rules say. Nothing is sent from here." id="preview">
        {!preview ? <p className="text-sm text-muted-foreground">Working it out...</p> : !preview.ok ? <p className="text-sm text-muted-foreground">Fix the layout above to see the preview.</p> : (
          <div data-testid="setup-preview" className="space-y-4">
            {preview.sections.length === 0 && <p className="text-sm text-muted-foreground">Nothing is written to your CRM with these choices. Calls stay in SubSync.</p>}
            {preview.sections.map((s) => (
              <div key={s.label}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}{s.parts.length > 1 ? ` (${s.parts.length} items)` : ""}</p>
                {s.parts.map((p, i) => <pre key={i} className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap border-l-2 border-border py-1 pl-3 text-sm leading-6">{p}</pre>)}
              </div>
            ))}
            {preview.fields.length > 0 && (
              <div data-testid="preview-fields">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contact fields</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {preview.fields.map((f) => <li key={f.item}><span className="font-medium">{f.label}:</span> <span className={f.status === "skip" ? "text-muted-foreground" : ""}>{f.text}</span></li>)}
                </ul>
              </div>
            )}
            {preview.clips.length > 0 && <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Left out by your admin&apos;s rules</p><ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{preview.clips.map((c) => <li key={c}>{c}</li>)}</ul></div>}
            {preview.remarks.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground">{preview.remarks.map((c) => <li key={c}>{c}</li>)}</ul>}
          </div>
        )}
      </Section>

      <div className="mb-8"><Btn variant="primary" disabled={busy || !!problem} onClick={() => void save()}>{busy ? "Saving..." : "Save my choices"}</Btn></div>
    </div>
  );
}

// ---------------- an admin: the account's rules, defaults, locks and fields ----------------

type AccountData = {
  demo: boolean; locationId: string; accountName: string; company: PolicyFlags; set: PolicyFlags; effective: PolicyFlags; hasMapping: boolean; companyLocked: string[];
};
type FieldsData = {
  demo: boolean; locationId: string; mappings: Array<{ item: string; customFieldId: string; fieldName: string; fieldType: string; enabled: boolean }>;
  items: Array<{ item: string; label: string; defaultOn: boolean }>; warnings: string[];
  definitions: { ok: true; fields: Array<{ id: string; name: string; type: string; fits: string[] }> } | { ok: false; message: string };
};

const LOCK_WORDS: Array<{ key: "preset" | "destinations" | "unmatchedMode" | "sourcePriority"; label: string }> = [
  { key: "preset", label: "Everyone uses the default layout (people cannot pick another)" },
  { key: "destinations", label: "Nobody can use the Custom table (ready-made layouts only)" },
  { key: "unmatchedMode", label: "Calls nobody matches are handled the way set here" },
  { key: "sourcePriority", label: "The order of meeting tools is the one set here" },
];

export function AccountSetup({ setup }: { setup: SetupData | null }) {
  const accounts = setup?.admin.accounts ?? [];
  const [loc, setLoc] = useState("");
  if (!setup) return null;
  const chosen = loc || setup.admin.ownAccount || accounts[0]?.locationId || "";
  return (
    <div data-testid="meeting-setup-admin">
      {accounts.length > 1 && !setup.admin.ownAccount && (
        <label className="mb-4 block max-w-sm text-sm"><span className="mb-1 block text-muted-foreground">Client account</span>
          <select className={inputClass} value={chosen} onChange={(e) => setLoc(e.target.value)}>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>
        </label>
      )}
      {chosen ? <AccountRules key={chosen} locationId={chosen} /> : <p className="text-sm text-muted-foreground">There is no client account to set up yet.</p>}
      {setup.admin.canSetCompany && setup.admin.company && <CompanyDefaults company={setup.admin.company} saved={setup.admin.companySaved === true} />}
    </div>
  );
}

/** The company owner's defaults. They sit above every account: an account can only make the limits stricter, and a lock set here cannot be undone below. */
function CompanyDefaults({ company, saved }: { company: PolicyFlags; saved: boolean }) {
  const api = useApiClient();
  const [draft, setDraft] = useState<PolicyFlags | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const flags = draft ?? company;
  const update = (p: Partial<PolicyFlags>) => setDraft({ ...flags, ...p });
  const toggleDest = (d: "comment" | "field", on: boolean) => update({ destinations: on ? [...new Set([...flags.destinations, d, "note" as const])] : flags.destinations.filter((x) => x !== d) });
  const save = async () => {
    if (!draft) return;
    setSaving(true); setMsg(null);
    try { await api.put("meeting-policy", { scope: "agency", flags: draft }); setDraft(null); setMsg({ ok: true, text: "Saved. Open a client account above to see the result." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setSaving(false); }
  };
  return (
    <Section title="Company defaults" hint="These sit above every client account. An account can only make them stricter, and a lock set here cannot be undone below." id="company-defaults" className="mt-8">
      {msg && <div className="mb-3"><InlineAlert tone={msg.ok ? "success" : "danger"} onDismiss={() => setMsg(null)}>{msg.text}</InlineAlert></div>}
      {!saved && !msg && <div className="mb-3"><InlineAlert tone="info">No company rule is saved yet, so each account decides for itself. Saving here sets a limit for every account.</InlineAlert></div>}
      <div className="space-y-2 text-sm" data-testid="company-defaults">
        <label className="flex items-center gap-2"><input type="checkbox" checked={flags.destinations.includes("comment")} onChange={(e) => toggleDest("comment", e.target.checked)} /> Allow conversation comments</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={flags.destinations.includes("field")} onChange={(e) => toggleDest("field", e.target.checked)} /> Allow contact fields (each account still has to choose its fields)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={flags.allowTranscripts} onChange={(e) => update({ allowTranscripts: e.target.checked })} /> Allow full transcripts in your CRM</label>
        <label className="block max-w-sm"><span className="mb-1 block text-muted-foreground">Default layout</span>
          <select className={inputClass} value={flags.defaults.preset ?? "recommended"} onChange={(e) => update({ defaults: { ...flags.defaults, preset: e.target.value as "recommended" | "full_record" | "summary_only" } })}>
            <option value="recommended">Recommended</option><option value="full_record">Full record</option><option value="summary_only">Summary only</option>
          </select></label>
        <label className="block max-w-sm"><span className="mb-1 block text-muted-foreground">Calls nobody matches</span>
          <select className={inputClass} value={flags.defaults.unmatchedMode ?? "inbox"} onChange={(e) => update({ defaults: { ...flags.defaults, unmatchedMode: e.target.value as "inbox" | "discard" } })}>
            <option value="inbox">Keep it in the person&apos;s Meeting inbox</option><option value="discard">Do not keep it (only counted)</option>
          </select></label>
        <fieldset className="space-y-1.5"><legend className="mb-1 text-muted-foreground">Lock these for every account</legend>
          {LOCK_WORDS.map((l) => (
            <label key={l.key} className="flex items-center gap-2"><input type="checkbox" checked={flags.locked.includes(l.key)} onChange={(e) => update({ locked: e.target.checked ? [...new Set([...flags.locked, l.key])] : flags.locked.filter((x) => x !== l.key) })} /> {l.label}</label>
          ))}
        </fieldset>
      </div>
      <div className="mt-3"><Btn variant="primary" disabled={!draft || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save company defaults"}</Btn></div>
    </Section>
  );
}

function AccountRules({ locationId }: { locationId: string }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<AccountData>(`meeting-setup/account?account=${encodeURIComponent(locationId)}`);
  const fields = useData<FieldsData>(`meeting-setup/fields?account=${encodeURIComponent(locationId)}`);
  const [draft, setDraft] = useState<PolicyFlags | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <SkeletonRows rows={4} label="Loading this account's setup" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const flags = draft ?? data.set;
  const lockedByCompany = new Set(data.companyLocked);
  const update = (p: Partial<PolicyFlags>) => setDraft({ ...flags, ...p });
  const hasField = data.hasMapping;

  const toggleDest = (d: "comment" | "field", on: boolean) => update({ destinations: on ? [...new Set([...flags.destinations, d, "note" as const])] : flags.destinations.filter((x) => x !== d) });
  const toggleLock = (k: string, on: boolean) => update({ locked: on ? [...new Set([...flags.locked, k])] : flags.locked.filter((x) => x !== k) });

  const save = async () => {
    if (!draft) return;
    setSaving(true); setMsg(null);
    try {
      const r = await api.put<{ ok: boolean; notes?: string[] }>("meeting-policy", { scope: "account", locationId, flags: draft });
      await reload(); setDraft(null);
      setMsg({ ok: true, text: r.notes && r.notes.length ? `Saved. ${r.notes.join(" ")}` : "Saved." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setSaving(false); }
  };

  return (
    <div>
      <h2 className="mb-3 text-base font-semibold">{data.accountName}</h2>
      {msg && <div className="mb-3"><InlineAlert tone={msg.ok ? "success" : "danger"} onDismiss={() => setMsg(null)}>{msg.text}</InlineAlert></div>}

      <Section title="What your team may use" hint="A person can only choose places you allow here. The company's own limits sit above this." id="allowed">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked disabled /> Contact note (always on)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={flags.destinations.includes("comment")} onChange={(e) => toggleDest("comment", e.target.checked)} /> Conversation comment (only your team sees it, never the contact)</label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={flags.destinations.includes("field")} disabled={!hasField} onChange={(e) => toggleDest("field", e.target.checked)} />
            <span>Contact field{!hasField && <span className="block text-xs text-muted-foreground">Choose at least one contact field below first. Nothing is written to a field until you do.</span>}</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={flags.allowTranscripts} onChange={(e) => update({ allowTranscripts: e.target.checked })} />
            <span>Allow full transcripts in your CRM<span className="block text-xs text-muted-foreground">Off is safest: a transcript holds other people&apos;s words. A person must also turn it on for themselves. A long one is saved as a link.</span></span></label>
        </div>
      </Section>

      <Section title="Defaults and locks" hint="What a new person gets, and what nobody can change." id="defaults">
        <div className="space-y-3 text-sm">
          <label className="block max-w-sm"><span className="mb-1 block text-muted-foreground">Default layout for new people</span>
            <select className={inputClass} value={flags.defaults.preset ?? "recommended"} disabled={lockedByCompany.has("preset")} onChange={(e) => update({ defaults: { ...flags.defaults, preset: e.target.value as "recommended" | "full_record" | "summary_only" } })}>
              <option value="recommended">Recommended</option><option value="full_record">Full record</option><option value="summary_only">Summary only</option>
            </select></label>
          <label className="block max-w-sm"><span className="mb-1 block text-muted-foreground">Calls nobody matches</span>
            <select className={inputClass} value={flags.defaults.unmatchedMode ?? "inbox"} disabled={lockedByCompany.has("unmatchedMode")} onChange={(e) => update({ defaults: { ...flags.defaults, unmatchedMode: e.target.value as "inbox" | "discard" } })}>
              <option value="inbox">Keep it in the person&apos;s Meeting inbox</option><option value="discard">Do not keep it (only counted)</option>
            </select></label>
          <fieldset className="space-y-1.5"><legend className="mb-1 text-muted-foreground">Lock these so people cannot change them</legend>
            {LOCK_WORDS.map((l) => (
              <label key={l.key} className="flex items-center gap-2"><input type="checkbox" checked={flags.locked.includes(l.key) || lockedByCompany.has(l.key)} disabled={lockedByCompany.has(l.key)} onChange={(e) => toggleLock(l.key, e.target.checked)} />
                {l.label}{lockedByCompany.has(l.key) && <span className="text-xs text-muted-foreground"> (set by your company)</span>}</label>
            ))}
          </fieldset>
        </div>
        <div className="mt-3"><Btn variant="primary" disabled={!draft || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save account setup"}</Btn></div>
      </Section>

      <FieldMapping data={fields} locationId={locationId} onSaved={async () => { await fields.reload(); await reload(); }} />
    </div>
  );
}

function FieldMapping({ data, locationId, onSaved }: { data: ReturnType<typeof useData<FieldsData>>; locationId: string; onSaved: () => Promise<void> }) {
  const api = useApiClient();
  const [pick, setPick] = useState<Record<string, { id: string; enabled: boolean }>>({});
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (data.loading && !data.data) return <SkeletonRows rows={3} label="Loading contact fields" />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d) return null;

  const current = (item: string) => pick[item] ?? (() => { const m = d.mappings.find((x) => x.item === item); return { id: m?.customFieldId ?? "", enabled: m?.enabled ?? d.items.find((i) => i.item === item)?.defaultOn ?? false }; })();
  const changed = Object.keys(pick).length > 0;
  const turnsOn = d.items.some((i) => { const c = current(i.item); return c.id !== "" && c.enabled; });

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put("meeting-setup/fields", { locationId, acknowledged: ack, mappings: d.items.map((i) => { const c = current(i.item); return { item: i.item, customFieldId: c.id || null, enabled: c.enabled }; }) });
      setPick({}); setAck(false); await onSaved();
      setMsg({ ok: true, text: "Saved. A field is only written when a call is saved to a contact and the newest call wins." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setSaving(false); }
  };

  return (
    <Section title="Contact fields" hint="Fill one of your own contact fields with the latest call. Notes keep the history; a field holds one current value." id="fields">
      {msg && <div className="mb-3"><InlineAlert tone={msg.ok ? "success" : "danger"} onDismiss={() => setMsg(null)}>{msg.text}</InlineAlert></div>}
      {!d.definitions.ok ? <InlineAlert tone="warning" title="Cannot show your fields">{d.definitions.message}</InlineAlert> : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">Nothing is filled until you choose a field here. Fields turned off, and calls older than what is already in a field, are never written.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="field-mapping">
              <caption className="sr-only">Which contact field each item fills</caption>
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Fill this</th><th scope="col" className="py-2 pr-3 font-medium">Contact field</th><th scope="col" className="py-2 font-medium">On</th></tr></thead>
              <tbody>
                {d.items.map((i) => {
                  const c = current(i.item);
                  const options = d.definitions.ok ? d.definitions.fields.filter((f) => f.fits.includes(i.item)) : [];
                  return (
                    <tr key={i.item} className="border-b">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">{i.label}</th>
                      <td className="py-2 pr-3">
                        <select aria-label={`Contact field for ${i.label}`} className={inputClass + " max-w-xs"} value={c.id} onChange={(e) => setPick({ ...pick, [i.item]: { id: e.target.value, enabled: e.target.value === "" ? false : c.enabled } })}>
                          <option value="">Not set up</option>
                          {options.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.type})</option>)}
                          {c.id !== "" && !options.some((f) => f.id === c.id) && <option value={c.id}>{d.mappings.find((m) => m.item === i.item)?.fieldName ?? "Chosen field"}</option>}
                        </select>
                      </td>
                      <td className="py-2"><input type="checkbox" aria-label={`Turn on ${i.label}`} checked={c.enabled && c.id !== ""} disabled={c.id === ""} onChange={(e) => setPick({ ...pick, [i.item]: { id: c.id, enabled: e.target.checked } })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 space-y-1 text-sm" data-testid="field-warnings">
            <p className="font-medium">Before you turn a field on</p>
            <ul className="list-disc pl-5 text-muted-foreground">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have read both warnings</label>
          </div>
          <div className="mt-3"><Btn variant="primary" disabled={!changed || saving || (turnsOn && !ack)} onClick={() => void save()}>{saving ? "Saving..." : "Save contact fields"}</Btn></div>
        </>
      )}
    </Section>
  );
}
