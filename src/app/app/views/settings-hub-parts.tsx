"use client";

import { useState } from "react";
import { COMPANY } from "@/lib/company";
import { FEATURE_NEEDS } from "@/lib/scope-groups";
import { NEEDS_PERMISSION } from "@/lib/meeting-wording";
import { HIDEABLE_MODULES } from "@/lib/settings2";
import { useData } from "../session";
import { Badge, Btn, Card, ErrorBox, Loading } from "../ui";
import { WriteAccessCard } from "./write-access";
import { useStState } from "./st-state";
import type { PermissionGroup } from "./settings-parts";

export type Home = { kind: string; plan: string; canManage: boolean; level: string; enforced: boolean; since: string | null; demo: boolean };

export function ReadOnlyNote() {
  return <p className="border-l-2 border-warning py-1 pl-3 text-sm" data-testid="read-only">Only your administrator can change these. You can read them here.</p>;
}

// ---------------- Account and plan ----------------
export function PlanCard({ home }: { home: Home }) {
  const word = home.plan === "pro" ? "Pro" : home.plan === "starter" ? "Starter" : "Free";
  return (
    <Card title="Your plan">
      <p className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={home.plan === "free" ? "neutral" : "good"}>{word}</Badge>
        <span className="text-muted-foreground">{home.enforced ? "Some pages are part of the paid plan." : "Every page is open to you right now."}</span></p>
      <p className="mt-2 text-xs text-muted-foreground">Billing and plan changes are handled in the marketplace where you installed SubSync. SubSync never asks for a card.</p>
    </Card>
  );
}

// ---------------- Connections ----------------
export { ConnectionsSection } from "./connections-section";

// ---------------- Permissions ----------------
type Settings = { permissions?: PermissionGroup[] };

export function PermissionsSection() {
  const { data, error, loading, reload } = useData<Settings>("settings");
  const [q, setQ] = useState("");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const groups = data?.permissions;
  if (!groups) return <p className="text-sm text-muted-foreground">Permissions are not listed for sample data.</p>;
  const unlocks = (scope: string) => FEATURE_NEEDS.filter((n) => n.scope === scope).map((n) => n.feature);
  const missing = groups.reduce((n, g) => n + g.missing, 0);
  const term = q.trim().toLowerCase();
  return (
    <div className="space-y-4">
      <p className={`border-l-2 py-1 pl-3 text-sm ${missing === 0 ? "border-success" : "border-warning"}`} role="status" data-testid="perm-summary">
        {missing === 0 ? "Every permission SubSync asks for is approved." : `${missing} permission${missing === 1 ? " is" : "s are"} not approved. ${NEEDS_PERMISSION}`}
      </p>
      {missing > 0 && (
        <Card title="How to reconnect">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open the apps page of your CRM (the marketplace, or your installed apps).</li>
            <li>Find SubSync and press <strong>Update</strong> or <strong>Reconnect</strong>.</li>
            <li>Approve the new permissions, then come back here. This page updates by itself.</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">Everything else keeps working in the meantime. Only the pages listed as needing a permission wait.</p>
        </Card>
      )}
      <label className="block text-sm font-medium" htmlFor="perm-q">Find a permission<input id="perm-q" type="search" className="mt-1 w-full rounded-lg border bg-card px-3 py-2 text-sm sm:max-w-sm" placeholder="For example: payments" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <ul className="divide-y rounded-lg border" data-testid="perm-list">
        {groups.flatMap((g) => g.scopes.map((s) => ({ g, s }))).filter(({ g, s }) => !term || `${g.title} ${s.scope} ${s.why}`.toLowerCase().includes(term)).map(({ g, s }) => (
          <li key={s.scope} className="px-3 py-3 text-sm" data-granted={s.granted ? "yes" : "no"}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{g.title}</span>
              <Badge tone={s.granted ? "good" : s.comingSoon ? "neutral" : "warn"}>{s.granted ? "Granted" : "Not granted"}</Badge>
              <span className="text-xs text-muted-foreground">{s.required ? "Required" : "Optional"} · {s.kind === "read" ? "reads only" : "can change, after a preview"}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{s.why}</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{s.scope}</p>
            {unlocks(s.scope).length > 0 && <p className="mt-1 text-xs">Unlocks: {unlocks(s.scope).join("; ")}.</p>}
            {s.comingSoon && !s.granted && <p className="mt-1 text-xs font-medium">For a coming feature. Not used yet, so nothing changes whether you grant it or not.</p>}
            {!s.granted && !s.comingSoon && <p className="mt-1 text-xs font-medium text-warning">{NEEDS_PERMISSION}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- Modules ----------------
export function ModulesSection({ features }: { features: Record<string, boolean> }) {
  const { marks, set } = useStState();
  const hidden = new Set(marks.module_hidden);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Hide the pages you do not use from your own menu. This changes only what you see. Nobody else is affected, and nothing is deleted. Pages that are switched off for your account are not listed.</p>
      <ul className="divide-y rounded-lg border" data-testid="modules-list">
        {HIDEABLE_MODULES.filter((m) => features[m.id === "cleanup" ? "cleanup" : m.id === "people" ? "search" : m.id === "audit" ? "audit" : m.id === "payments" ? "pm_module" : m.id === "data-health" ? "data_health" : m.id === "pipeline" ? "pipelines" : m.id] !== false).map((m) => {
          const shown = !hidden.has(m.id);
          return (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0"><span className="block text-sm font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{m.what}</span></span>
              <button type="button" role="switch" aria-checked={shown} aria-label={`Show ${m.name} in my menu`} onClick={() => void set("module_hidden", m.id, shown)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors before:absolute before:-inset-2.5 before:content-[''] ${shown ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${shown ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------- Safety ----------------
export function SafetySection() {
  return (
    <div className="space-y-4">
      <Card title="Reading by default">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>SubSync reads your CRM. It never replies to a lead for you.</li>
          <li>A change in a client account happens only where you switched it on below, only after a preview, and only after you confirm.</li>
          <li>A dry run shows exactly what would change and changes nothing. While the server&apos;s live switch is off, every change is a dry run, even for an allowed client.</li>
          <li>People who asked not to be contacted, and contacts with open deals, payments or booked appointments, are protected from deletes and merges.</li>
        </ul>
      </Card>
      <Card title="Which clients may be changed"><WriteAccessCard embedded /></Card>
    </div>
  );
}

// ---------------- Help and support ----------------
export function HelpSection({ go }: { go: () => void }) {
  return (
    <div className="space-y-4">
      <Card title="Learn SubSync"><p className="text-sm text-muted-foreground">A checklist that tracks your progress and a 60-second guide for every page.</p><div className="mt-2"><Btn variant="primary" onClick={go}>Open Getting started</Btn></div></Card>
      <Card title="Talk to us">
        <p className="text-sm">Write to <a className="font-medium underline underline-offset-4" href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. We reply within {COMPANY.supportReply}.</p>
        <p className="mt-2 text-sm">You can also use <strong>Give feedback</strong> or <strong>Report a problem</strong> at the bottom of any page. <a className="underline underline-offset-4" href="/trust" target="_blank" rel="noreferrer">What we read and store</a>.</p>
      </Card>
    </div>
  );
}
