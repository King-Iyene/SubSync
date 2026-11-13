"use client";

import { useState } from "react";
import { BrandLogo } from "../brand-logo";
import { describeChange } from "@/lib/settings-sections";
import { NEEDS_PERMISSION } from "@/lib/meeting-wording";
import { useData } from "../session";
import { Badge, Btn, Card, ErrorBox, Loading, timeAgo } from "../ui";

// The pieces of Settings that are not plain form fields: the permissions panel (N64), the test-account switches (N1), who can open SubSync, and the history of changes.

export type PermissionGroup = { id: string; title: string; summary: string; missing: number; scopes: Array<{ scope: string; kind: "read" | "change"; required: boolean; why: string; granted: boolean; comingSoon?: boolean }> };

// "What SubSync can read": each group of permissions with a plain reason, and which ones this install granted. A missing one says the same words as every
// other prompt: "Needs permission: reconnect". Nothing here changes anything; the permissions are approved when SubSync is opened from your CRM.
export function PermissionsPanel({ groups }: { groups: PermissionGroup[] | null | undefined }) {
  if (!groups) return null;
  const missing = groups.reduce((n, g) => n + g.missing, 0);
  return (
    <Card title="What SubSync can read">
      <p className="mb-3 text-sm text-muted-foreground" data-testid="permissions-summary">
        {missing === 0 ? "Every permission SubSync asks for has been approved on your account." : `${missing} permission${missing === 1 ? " is" : "s are"} not approved on your account yet. Features that need one say "${NEEDS_PERMISSION}" and everything else keeps working.`}
        {" "}Open the <a className="underline underline-offset-4" href="/trust#read" target="_blank" rel="noreferrer">Trust page</a> for the full list.
      </p>
      <ul className="divide-y rounded-lg border text-sm">
        {groups.map((g) => (
          <li key={g.id}>
            <div className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                <span>{g.title} <span className="font-normal text-muted-foreground">: {g.summary}</span></span>
                {g.missing > 0 ? <Badge tone="warn">{NEEDS_PERMISSION}</Badge> : <Badge tone="good">Approved</Badge>}
              </div>
              <ul className="mt-2 space-y-2 pb-1">
                {g.scopes.map((s) => (
                  <li key={s.scope} className="leading-5">
                    <span className="font-mono text-xs">{s.scope}</span> <span className="text-xs text-muted-foreground">({s.required ? "required" : "optional"}, {s.kind === "read" ? "reads" : "can change"})</span>{" "}
                    {!s.granted && <span className="text-xs font-medium text-warning">{NEEDS_PERMISSION}</span>}
                    <span className="block text-muted-foreground">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type TestAccount = { locationId: string; name: string; ignored: boolean; looksTest: boolean };

// Test accounts (N1, KF-7): the owner decides which accounts are leave-outs. SubSync only guesses from the name; nothing is left out until the owner says so.
// An account that is left out stops counting everywhere (numbers, alerts, lists, reports): the same switch as "Ignore" on the account page. Nothing is deleted.
export function TestAccountsCard({ accounts, busy, onToggle }: { accounts: TestAccount[]; busy: boolean; onToggle: (a: TestAccount) => void }) {
  const suggested = accounts.filter((a) => a.looksTest && !a.ignored);
  return (
    <Card title="Test and practice accounts">
      <p className="mb-3 text-sm text-muted-foreground">
        A practice or demo account inflates every total. Switch one on and it stops counting everywhere: numbers, alerts, lists and reports. Nothing is deleted, and you can switch it back at any time.
        You decide: SubSync only suggests accounts whose name says test, demo, sample or sandbox.
      </p>
      {suggested.length > 0 && (
        <p className="mb-3 border-l-2 border-warning py-1 pl-3 text-sm" data-testid="test-suggestion">
          {suggested.length === 1 ? `${suggested[0].name} looks like a test account.` : `${suggested.length} accounts look like test accounts: ${suggested.map((s) => s.name).join(", ")}.`}{" "}
          <button type="button" className="font-medium underline underline-offset-4" disabled={busy} onClick={() => suggested.forEach((s) => onToggle(s))}>Leave {suggested.length === 1 ? "it" : "them"} out</button>
        </p>
      )}
      {accounts.length === 0 ? <p className="text-sm text-muted-foreground">No client accounts yet.</p> : (
        <ul className="divide-y rounded-lg border text-sm" aria-label="Accounts to leave out of every number">
          {accounts.map((a) => (
            <li key={a.locationId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0"><span className="font-medium">{a.name}</span>{a.looksTest && <span className="ml-2 text-xs text-muted-foreground">its name says test</span>}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{a.ignored ? "Left out of every number" : "Counted"}</span>
                <button type="button" role="switch" aria-checked={a.ignored} aria-label={`Leave ${a.name} out of every number`} disabled={busy} onClick={() => onToggle(a)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${a.ignored ? "bg-primary" : "bg-muted-foreground/40"}`}>
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${a.ignored ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WhoCanOpenCard({ agency }: { agency: boolean }) {
  return (
    <Card title="Who can open SubSync">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {agency ? (
          <>
            <li><strong className="font-medium text-foreground">The owner and administrators of your company</strong> see every client account and all settings. Only the owner can press Delete my data.</li>
            <li><strong className="font-medium text-foreground">A client&apos;s own staff</strong> see a read-only view of their own account, only when you switch client access on for that account (above). Never other clients, your fees, notes or settings.</li>
            <li><strong className="font-medium text-foreground">Your company&apos;s other staff</strong> cannot open SubSync yet. SubSync shows nothing until it can check which client accounts each person may use.</li>
          </>
        ) : (
          <>
            <li><strong className="font-medium text-foreground">The administrator of this account</strong> sees everything for this account, including these settings. Only the administrator can press Delete my data.</li>
            <li><strong className="font-medium text-foreground">Other staff in this account</strong> see a read-only view of this account, with no settings.</li>
          </>
        )}
      </ul>
    </Card>
  );
}

// The audit log of settings changes, read back in words: who, when, which setting by name, never a value.
export function SettingsHistoryCard() {
  const { data, error, loading, reload } = useData<{ rows: Array<{ action: string; actor: string | null; at: string; keys: string[] }> }>("settings/history");
  const [open, setOpen] = useState(false);
  if (loading && !data) return <Card title="History of changes"><Loading /></Card>;
  if (error) return <Card title="History of changes"><ErrorBox error={error} onRetry={reload} /></Card>;
  const rows = data?.rows ?? [];
  return (
    <Card title="History of changes">
      <p className="mb-3 text-sm text-muted-foreground">Every change to a setting is recorded here with who made it and when. Values are never shown: a Slack address, for example, is a secret.</p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="history-empty">No changes recorded yet. The next time someone saves a setting it appears here.</p> : (
        <>
          <ul className="divide-y rounded-lg border text-sm" data-testid="settings-history">
            {(open ? rows : rows.slice(0, 5)).map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span>{describeChange(r.action, r.keys)}</span>
                <span className="text-xs text-muted-foreground">{r.actor ?? "Someone"} · {timeAgo(r.at)}</span>
              </li>
            ))}
          </ul>
          {rows.length > 5 && <div className="mt-2"><Btn variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Show fewer" : `Show all ${rows.length}`}</Btn></div>}
        </>
      )}
    </Card>
  );
}

export function BrandPreview({ name, color, logoUrl }: { name: string | null; color: string | null; logoUrl?: string | null }) {
  const accent = color ?? "#5b789a";
  return (
    <div className="mt-4 rounded-lg border p-3" aria-label="Preview" data-testid="brand-preview">
      <p className="mb-2 text-xs text-muted-foreground">Preview: your name and colour, as they appear on printed reports and share links.</p>
      <div className="flex items-center gap-3">
        <BrandLogo url={logoUrl} name={name?.trim() || null} height={40} fallback={<>
          <span aria-hidden className="size-8 shrink-0 rounded-md" style={{ background: accent }} />
          <span className="text-base font-semibold">{name?.trim() || "Your company name"}</span>
        </>} />
      </div>
    </div>
  );
}

