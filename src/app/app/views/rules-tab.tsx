"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SURVIVORSHIP, FIELD_WORDS, PRESETS, describeRules, presetOf, type FieldKey, type MatchRules, type PresetId, type Survivorship, type Winner } from "@/lib/analytics/cleanup-rules";
import { ErrorState, HowTo, InlineAlert, Section, SkeletonCards } from "../ds";
import { useApiClient, useData } from "../session";
import { fmtInt } from "../ui";
import { BTN, FIELD, PRIMARY, QUIET } from "./cleanup-parts";
import { WriteAccessCard } from "./write-access";

// The Clean-up rules (stage CLEANUP): how strictly SubSync matches duplicates (three plain presets or your own mix), which value wins when two records disagree, the merge
// workflow of each client, and a copyable recipe that stops new duplicates at the source. Saved per client account with a company default underneath. The choices only change
// what SubSync SHOWS; they never change a contact. A client's staff cannot change them (the route refuses it), they only see which rules apply.

type Cfg = { match: MatchRules; survive: Survivorship; mergeWorkflowId: string | null; preventTag?: boolean };
type Data = {
  total: number;
  ready: { rules: boolean; defaults: boolean }; demo: boolean; multi: boolean; canCompany: boolean; masterSwitchOn: boolean;
  presets: Array<{ id: Exclude<PresetId, "custom">; label: string; line: string; rules: MatchRules }>; winnerWords: Record<Winner, string>;
  accounts: { rows: Array<{ locationId: string; name: string; preset: string; source: string }>; page: number; pages: number; total: number; from: number; to: number };
  company: (Cfg & { preset: string; saved: boolean; sentence: string }) | null;
  selected: (Cfg & { locationId: string; name: string; preset: string; source: string; sentence: string }) | null;
};

const FIELDS: Array<{ key: FieldKey; label: string }> = [{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "owner", label: "Belongs to" }, { key: "source", label: "Came from" }];
const SOURCE_WORD: Record<string, string> = { account: "its own rules", company: "the company default", builtin: "the built-in Balanced rules" };

export const WORKFLOW_STEPS = [
  "In your CRM, open this client account, go to Automation, then Workflows, and create a workflow named SubSync merge.",
  "Choose the trigger Contact Tag, and set it to the tag subsync-merge (or use any trigger you prefer; SubSync adds the contact to this workflow directly).",
  "Add the action Merge Contact, set Match By to Email and Phone Number, and save.",
  "Publish the workflow. A workflow that is not published does nothing.",
  "Copy the workflow's id from its address in your browser and paste it here.",
];

export const PREVENT_RECIPE = [
  "Switch off duplicates at the source, in your CRM, for each client account: Settings, Business Profile, Contact Preferences (or General), and turn off Allow Duplicate Contact.",
  "Choose what counts as the same person: set the primary field to Email and the secondary to Phone, so a form that repeats either one updates the contact it finds instead of making a new one.",
  "Check every form, survey, calendar and ad integration: each should create contacts the normal way, not through a copy that skips the duplicate check.",
  "For lists you import, use Check a file before you import it (Data quality) first, and import only the new people.",
  "Add a workflow that tags any contact created by a form with the form's name, so you can see where duplicates come from next time.",
];

export function RulesTab({ canEdit }: { canEdit: boolean }) {
  const [scope, setScope] = useState<string>("");
  const [ap, setAp] = useState(0);
  const [aq, setAq] = useState("");
  const { data, error, loading, reload } = useData<Data>(`cleanup/rules?ap=${ap}&aq=${encodeURIComponent(aq)}${scope && scope !== "company" ? `&account=${encodeURIComponent(scope)}` : ""}`);
  const [copied, setCopied] = useState<string | null>(null);

  if (!data && loading) return <SkeletonCards cards={2} label="Loading the rules..." />;
  if (!data) return error ? <ErrorState error={error} onRetry={reload} /> : null;
  const target = scope === "company" ? data.company : data.selected;
  const name = scope === "company" ? "Every client without its own rules" : data.selected?.name ?? "This client";
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(text); } catch { setCopied(text); } };

  return (
    <div data-testid="rules-tab">
      <HowTo id="rules" title="You choose how careful SubSync is">
        These choices only change which contacts SubSync suggests are duplicates and which value it suggests keeping. They never change a contact. Normal is how SubSync has always matched.
      </HowTo>
      {!data.ready.rules && <div className="mb-4"><InlineAlert tone="warning">Saving rules is not available yet: SubSync is finishing an update. You can try the settings and see what they would find, but not save them.</InlineAlert></div>}

      {data.multi && (
        <Section title="Which client" hint={`${fmtInt(data.total)} client accounts. A client without its own choice follows the company default.`} id="rules-scope">
          {data.total > 8 && <input type="search" className={`${FIELD} mb-2 w-full sm:w-64`} placeholder="Find a client" aria-label="Find a client" value={aq} onChange={(e) => { setAq(e.target.value); setAp(0); }} />}
          <ul data-testid="rules-accounts">
            {data.canCompany && (
              <li className="border-t py-1">
                <button type="button" className={`flex min-h-11 w-full items-center justify-between gap-3 rounded px-2 text-left text-sm hover:bg-accent/50 ${scope === "company" ? "font-semibold" : ""}`} aria-pressed={scope === "company"} onClick={() => setScope("company")} data-testid="rules-company">
                  <span>All clients (the company default)</span><span className="text-sm text-muted-foreground">{data.company?.saved ? data.company.preset : "not set"}</span>
                </button>
              </li>
            )}
            {data.accounts.rows.map((a) => (
              <li key={a.locationId} className="border-t py-1">
                <button type="button" className={`flex min-h-11 w-full items-center justify-between gap-3 rounded px-2 text-left text-sm hover:bg-accent/50 ${(scope || data.selected?.locationId) === a.locationId ? "font-semibold" : ""}`} aria-pressed={(scope || data.selected?.locationId) === a.locationId} onClick={() => setScope(a.locationId)} data-testid="rules-account">
                  <span className="truncate">{a.name}</span><span className="shrink-0 text-sm text-muted-foreground">{a.preset}{a.source === "company" ? " (company)" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {data.accounts.pages > 1 && (
            <div className="mt-2 flex items-center justify-between text-sm"><span className="text-sm text-muted-foreground">Showing {data.accounts.from} to {data.accounts.to} of {data.accounts.total}</span>
              <span className="flex gap-2"><button type="button" className={BTN} disabled={data.accounts.page === 0} onClick={() => setAp(ap - 1)}>Previous</button><button type="button" className={BTN} disabled={data.accounts.page >= data.accounts.pages - 1} onClick={() => setAp(ap + 1)}>Next</button></span></div>
          )}
        </Section>
      )}

      {target ? (
        <Editor key={(scope || data.selected?.locationId || "x") + JSON.stringify(target.match) + String(target.mergeWorkflowId)} data={data} cfg={target} scope={scope === "company" ? "company" : data.selected!.locationId} name={name}
          own={scope === "company" ? "company" : data.selected!.source} canEdit={canEdit} canSave={canEdit && data.ready.rules && (scope !== "company" || data.ready.defaults)} onSaved={reload} />
      ) : null}

      <Section title="Stop new duplicates" hint="Five steps in your CRM, so the list stops growing." id="rules-prevent" className="mt-8">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm" data-testid="prevent-recipe">{PREVENT_RECIPE.map((s) => <li key={s}>{s}</li>)}</ol>
        <button type="button" className={`${BTN} mt-3`} onClick={() => void copy(PREVENT_RECIPE.map((s, i) => `${i + 1}. ${s}`).join("\n"))} data-testid="prevent-copy">{copied?.startsWith("1. Switch off") ? "Copied" : "Copy these steps"}</button>
        <p className="mt-2 text-sm text-muted-foreground">SubSync cannot change these settings for you: it only reads. Old duplicates stay until they are merged.</p>
      </Section>

      {canEdit && <Section title="Changing contacts" hint="Off for every client until you allow it." id="rules-write" className="mt-8"><WriteAccessCard embedded /></Section>}
    </div>
  );
}

function Editor({ data, cfg, scope, name, own, canEdit, canSave, onSaved }: { data: Data; cfg: Cfg; scope: string; name: string; own: string; canEdit: boolean; canSave: boolean; onSaved: () => void }) {
  const api = useApiClient();
  const [rules, setRules] = useState<MatchRules>(cfg.match);
  const [survive, setSurvive] = useState<Survivorship>(cfg.survive ?? DEFAULT_SURVIVORSHIP);
  const [wf, setWf] = useState(cfg.mergeWorkflowId ?? "");
  const [tagNew, setTagNew] = useState(cfg.preventTag === true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const preset = presetOf(rules);
  const [effect, setEffect] = useState<{ now: { groups: number; extra: number }; with: { groups: number; extra: number } } | null>(null);
  // What would this setting find? Asked while a person chooses (one client at a time), never saved. A short pause so dragging the slider is not a request per pixel.
  const qs = scope === "company" ? "" : `account=${encodeURIComponent(scope)}&preset=${preset}${preset === "custom" ? `&email=${rules.email}&phone=${rules.phone}&name=${rules.name}&nameAlone=${rules.nameAlone ? 1 : 0}&guards=${rules.guards ? 1 : 0}&threshold=${rules.threshold}` : ""}`;
  useEffect(() => {
    if (!qs) return;
    let live = true;
    const t = setTimeout(() => { api.get<{ now: { groups: number; extra: number }; with: { groups: number; extra: number } }>(`cleanup/rules/preview?${qs}`).then((r) => { if (live) setEffect(r); }).catch(() => { if (live) setEffect(null); }); }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [qs, api]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(cfg.match) || JSON.stringify(survive) !== JSON.stringify(cfg.survive) || (wf.trim() || "") !== (cfg.mergeWorkflowId ?? "") || tagNew !== (cfg.preventTag === true);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.post("cleanup/rules", { scope, match: rules, survive, mergeWorkflowId: wf.trim() || null, preventTag: tagNew });
      setMsg({ ok: true, text: "Saved. Open Duplicates to see the groups with these rules." });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const back = async () => {
    setBusy(true); setMsg(null);
    try { await api.post("cleanup/rules/clear", { locationId: scope }); setMsg({ ok: true, text: "This client follows the company default again." }); onSaved(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const pick = (id: Exclude<PresetId, "custom">) => setRules(PRESETS[id]);
  const set = <K extends keyof MatchRules>(k: K, v: MatchRules[K]) => setRules((r) => ({ ...r, [k]: v, preset: "custom" }));

  return (
    <div data-testid="rules-editor">
      <Section title={`How careful, for ${name}`} hint={scope === "company" ? "Used for every client that has no choice of its own." : `Now using ${SOURCE_WORD[own] ?? "the built-in rules"}.`} id="rules-strict">
        <fieldset disabled={!canEdit} className="grid gap-2" data-testid="rules-presets">
          <legend className="sr-only">Matching strictness</legend>
          {data.presets.map((p) => (
            <label key={p.id} className={`flex min-h-11 cursor-pointer items-start gap-3 border-l-2 py-1.5 pl-3 ${preset === p.id ? "border-primary" : "border-transparent"}`}>
              <input type="radio" name="preset" className="mt-1 size-5 shrink-0" checked={preset === p.id} onChange={() => pick(p.id)} data-testid={`preset-${p.id}`} />
              <span className="min-w-0"><span className="block text-sm font-semibold">{p.label}{p.id === "balanced" ? " (the usual choice)" : ""}</span><span className="block text-sm text-muted-foreground">{p.line}</span></span>
            </label>
          ))}
        </fieldset>
        {effect && scope !== "company" && (
          <p className="mt-3 text-sm" data-testid="rules-effect">With this setting SubSync shows <strong className="tabular-nums" data-testid="rules-effect-groups">{fmtInt(effect.with.groups)}</strong> match{effect.with.groups === 1 ? "" : "es"} (people who appear more than once)
            <span className="text-muted-foreground"> {effect.with.groups === effect.now.groups ? "the same as now" : `instead of ${fmtInt(effect.now.groups)} now`}.</span></p>
        )}
        {preset === "custom" && <p className="mt-2 text-sm text-muted-foreground" data-testid="rules-custom">Your own mix: {describeRules(rules)}</p>}
        <details open className="mt-3" data-testid="rules-custom-box">
          <summary className="min-h-11 cursor-pointer text-sm font-medium">Choose the fields yourself</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <SelectField label="Email" value={rules.email} words={FIELD_WORDS.email} disabled={!canEdit} onChange={(v) => set("email", v as MatchRules["email"])} />
            <SelectField label="Phone" value={rules.phone} words={FIELD_WORDS.phone} disabled={!canEdit} onChange={(v) => set("phone", v as MatchRules["phone"])} />
            <SelectField label="Name" value={rules.name} words={FIELD_WORDS.name} disabled={!canEdit} onChange={(v) => set("name", v as MatchRules["name"])} />
          </div>
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" disabled={!canEdit} checked={rules.nameAlone} onChange={(e) => set("nameAlone", e.target.checked)} /><span>A name on its own can start a group (common names are never grouped)</span></label>
          <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" disabled={!canEdit} checked={rules.guards} onChange={(e) => set("guards", e.target.checked)} /><span>Be careful with a shared phone or a shared company mailbox (info@, sales@): they may be different people</span></label>
          <div className="mt-2 max-w-sm"><label htmlFor="thr" className="block text-sm">How sure SubSync must be before it shows a match</label>
            <input id="thr" type="range" min={25} max={90} step={5} className="mt-1 w-full" disabled={!canEdit} value={rules.threshold} onChange={(e) => set("threshold", Number(e.target.value))} data-testid="rules-threshold" aria-describedby="thr-h" />
            <p id="thr-h" className="text-sm text-muted-foreground">Lower finds more groups and more false alarms. Higher finds fewer.</p></div>
        </details>
      </Section>

      <Section title="Which value wins" hint="When two records disagree, this is the value SubSync suggests you keep. You can always pick differently in the merge screen." id="rules-wins">
        <div className="grid gap-3 sm:grid-cols-2" data-testid="rules-survive">
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-sm"><span className="mb-1 block text-sm text-muted-foreground">{f.label}</span>
              <select className={`${FIELD} w-full`} disabled={!canEdit} value={survive[f.key]} onChange={(e) => setSurvive({ ...survive, [f.key]: e.target.value as Winner })} data-testid={`survive-${f.key}`}>
                {(Object.keys(data.winnerWords) as Winner[]).map((w) => <option key={w} value={w}>{data.winnerWords[w]}</option>)}
              </select></label>
          ))}
        </div>
      </Section>

      <Section title="New contacts" hint="SubSync checks every new contact within seconds of it arriving." id="rules-arrivals">
        <p className="text-base text-muted-foreground">A new contact that looks like one you already have shows up as a card on the Duplicates tab and in your alerts. Nothing is changed in your CRM.</p>
        <label className="mt-2 flex min-h-11 items-start gap-2 text-base"><input type="checkbox" className="mt-1 size-5" disabled={!canEdit} checked={tagNew} onChange={(e) => setTagNew(e.target.checked)} data-testid="prevent-tag" /><span>Also add the tag <strong>possible-duplicate</strong> to it in my CRM (only if changing contacts is allowed for this client)</span></label>
      </Section>

      <Section title="Merge workflow" hint="Lets SubSync start a merge for you, through a workflow you own." id="rules-workflow">
        <p className="mb-2 text-sm text-muted-foreground">SubSync cannot merge two contacts by itself: your CRM has no merge call for apps. Its &quot;Merge Contact&quot; workflow action can, so you build that workflow once, per client, and SubSync adds a contact to it when you confirm a merge. The older record always survives, and a merge cannot be undone.</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="workflow-steps">{WORKFLOW_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <button type="button" className={`${BTN} mt-2`} onClick={async () => { try { await navigator.clipboard.writeText(WORKFLOW_STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n")); } catch { /* shown on screen anyway */ } setCopied(true); }} data-testid="workflow-copy">{copied ? "Copied" : "Copy these steps"}</button>
        <div className="mt-3 max-w-sm"><label htmlFor="wf" className="block text-sm">Workflow id</label>
          <input id="wf" className={`${FIELD} w-full`} disabled={!canEdit} placeholder="Paste the id from your CRM" value={wf} onChange={(e) => setWf(e.target.value)} data-testid="workflow-id" autoComplete="off" /></div>
      </Section>

      {canSave && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={PRIMARY} disabled={busy || !dirty} onClick={() => void save()} data-testid="rules-save">{busy ? "Saving..." : "Save these rules"}</button>
          {scope !== "company" && own === "account" && data.canCompany && <button type="button" className={QUIET} disabled={busy} onClick={() => void back()} data-testid="rules-clear">Go back to the company default</button>}
        </div>
      )}
      {msg && <div className="mt-3" role={msg.ok ? "status" : "alert"}><InlineAlert tone={msg.ok ? "info" : "danger"} onDismiss={() => setMsg(null)}>{msg.text}</InlineAlert></div>}
    </div>
  );
}

function SelectField({ label, value, words, disabled, onChange }: { label: string; value: string; words: Record<string, string>; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm"><span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      <select className={`${FIELD} w-full`} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} data-testid={`field-${label.toLowerCase()}`}>
        {Object.entries(words).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></label>
  );
}
