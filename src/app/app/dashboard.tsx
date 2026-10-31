"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NAV_FOR, type AccessKind } from "@/lib/access";
import {
  Briefcase, CalendarCheck, ClipboardCheck, Zap, CircleHelp, Copy, Eraser, Inbox, Kanban, LayoutDashboard, Mic, PhoneCall, Search, Settings, Sun, Target, UserRound, Users, Wrench, type LucideIcon,
  Sparkles,
} from "lucide-react";
import { NAV, type GoFn, type ViewId } from "./nav";
import { useBrandedText } from "./brand-text";
import { ApiProvider, makeApi, type Api } from "./session";
import { AccountDetailView } from "./views/account-detail";
import { AccountsView } from "./views/accounts";
import { AlertsView } from "./views/alerts";
import { AppointmentInsights } from "./views/appointment-insights";
import { AuditView } from "./views/audit";
import { SpeedView } from "./views/speed";
import { AppointmentsView } from "./views/appointments";
import { CleanupView } from "./views/cleanup";
import { MeetingsView } from "./views/meetings";
import { PlaybooksView } from "./views/playbooks";
import { CallsView } from "./views/calls";
import { ClientsView } from "./views/clients";
import { DealsView } from "./views/deals";
import { DuplicatesView } from "./views/duplicates";
import { EmailHealthView } from "./views/email-health";
import { HelpView } from "./views/help";
import { RoadmapView } from "./views/roadmap";
import { FreshnessStrip } from "./views/health-card";
import { InboxView } from "./views/inbox";
import { OnboardingView } from "./views/onboarding";
import { LeadsView } from "./views/leads";
import { OverviewView } from "./views/overview";
import { PipelineView } from "./views/pipeline";
import { DealMoves, TeamView } from "./views/people";
import { FilterBar } from "./views/filter-bar";
import { SearchView } from "./views/search";
import { SettingsView } from "./views/settings";
import { SetupCompareView } from "./views/setup-compare";
import { TodayView } from "./views/today";

type Auth =
  | { status: "waiting" }
  | { status: "outside" }
  | { status: "error"; message: string }
  | { status: "not_installed" }
  | { status: "maintenance"; message: string }
  | { status: "ready"; api: Api; demo: boolean; userName: string | null; features: Record<string, boolean>; locked: string[]; kind: AccessKind; locationId: string | null; brand: { name: string | null; color: string | null } };

type SsoResponse = {
  error?: string;
  installed?: boolean;
  maintenance?: boolean;
  demo?: boolean;
  session?: string;
  kind?: AccessKind;
  user?: { userName?: string | null; activeLocation?: string | null };
  entitlements?: { features: Record<string, boolean>; locked?: string[] };
  brand?: { name: string | null; color: string | null };
};

// Black or white text, whichever reads on the agency's chosen colour.
const onColour = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150 ? "#111111" : "#ffffff";
};

async function exchange(body: unknown): Promise<{ ok: boolean; status: number; data: SsoResponse }> {
  const res = await fetch("/api/sso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as SsoResponse };
}

// `/app#deals` or `/app#account=<id>` opens that view first. Handy for demos and screenshots;
// the signed-in session is still required to see any data.
function viewFromHash(): { id: ViewId; locationId?: string } {
  if (typeof window === "undefined") return { id: "today" };
  const hash = window.location.hash.slice(1);
  if (hash.startsWith("account=") && hash.length > 8) return { id: "account", locationId: decodeURIComponent(hash.slice(8)) };
  const match = NAV.find((n) => n.id === hash);
  return { id: match ? match.id : "today" };
}

// `?as=business` or `?as=client` opens the demo as a single business or as a client's staff.
// Only demo mode honours it; real sign-in decides the view from the host's user context.
function demoView(): "business" | "client" | undefined {
  if (typeof window === "undefined") return undefined;
  const as = new URLSearchParams(window.location.search).get("as");
  return as === "business" || as === "client" ? as : undefined;
}

export function Dashboard() {
  const [auth, setAuth] = useState<Auth>({ status: "waiting" });
  const [view, setView] = useState<{ id: ViewId; locationId?: string }>(viewFromHash);
  // Embedded in the host page: ask the parent who the user is. Assume embedded during server
  // render so the first paint matches.
  const embedded = useSyncExternalStore(() => () => {}, () => window.parent !== window, () => true);
  const pending = useRef<((payload: string | null) => void) | null>(null);
  // Bumped whenever the sign-in effect restarts, so a wait that began earlier cannot overwrite the current screen.
  const epoch = useRef(0);
  const refreshRef = useRef<() => Promise<string | null>>(async () => null);

  const apply = useCallback((r: { ok: boolean; status: number; data: SsoResponse }): string | null => {
    if (r.ok && r.data.installed === false) {
      setAuth({ status: "not_installed" });
      return null;
    }
    if (r.ok && r.data.session) {
      const demo = r.data.demo === true;
      setAuth({
        status: "ready", api: makeApi(r.data.session, () => refreshRef.current(), demo), demo,
        userName: r.data.user?.userName ?? null, features: r.data.entitlements?.features ?? {}, locked: r.data.entitlements?.locked ?? [],
        kind: r.data.kind ?? "agency", locationId: r.data.user?.activeLocation ?? null, brand: r.data.brand ?? { name: null, color: null },
      });
      return r.data.session;
    }
    if (r.data.maintenance) { setAuth({ status: "maintenance", message: r.data.error ?? "SubSync is down for a short maintenance. It will be back shortly." }); return null; }
    setAuth({ status: "error", message: r.data.error ?? "Could not sign you in." });
    return null;
  }, []);

  // Ask the host page for fresh encrypted user context and exchange it for a session.
  const signIn = useCallback(async (): Promise<string | null> => {
    const mine = epoch.current;
    const payload = await new Promise<string | null>((resolve) => {
      pending.current = resolve;
      window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
      setTimeout(() => {
        if (pending.current === resolve) {
          pending.current = null;
          resolve(null);
        }
      }, 6000);
    });
    // The page decided meanwhile that it is not embedded (or the effect restarted): this wait is stale, so it must not
    // overwrite what the page shows now.
    if (mine !== epoch.current) return null;
    if (!payload) {
      // The host did not answer. With demo mode on (never in production) show sample data
      // instead of dead-ending, which also covers previews that frame the page.
      const demo = await exchange({ demo: true, as: demoView() }).catch(() => null);
      if (demo?.ok) return apply(demo);
      setAuth({ status: "error", message: "No response from the host page. Please refresh." });
      return null;
    }
    try {
      return apply(await exchange({ payload }));
    } catch {
      setAuth({ status: "error", message: "Could not reach SubSync. Please refresh." });
      return null;
    }
  }, [apply]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { message?: string; payload?: unknown } | null;
      if (data?.message === "REQUEST_USER_DATA_RESPONSE" && typeof data.payload === "string" && pending.current) {
        const resolve = pending.current;
        pending.current = null;
        resolve(data.payload);
      }
    };
    window.addEventListener("message", onMessage);

    if (!embedded) {
      // Opened directly (not inside the host page). Demo mode, when enabled, shows sample data.
      void exchange({ demo: true, as: demoView() }).then((r) => {
        if (r.ok) apply(r);
        else if (r.data.maintenance) setAuth({ status: "maintenance", message: r.data.error ?? "SubSync is down for a short maintenance. It will be back shortly." });
        else setAuth({ status: "outside" });
      }).catch(() => setAuth({ status: "outside" }));
    } else {
      // signIn only sets state after awaiting the host page's reply, never synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void signIn();
    }
    return () => {
      epoch.current += 1;
      window.removeEventListener("message", onMessage);
    };
  }, [embedded, apply, signIn]);

  const go: GoFn = useCallback((id, locationId) => {
    setView({ id, locationId });
    window.scrollTo({ top: 0 });
  }, []);

  // The API client asks for a fresh session through this when a request comes back 401.
  useEffect(() => {
    refreshRef.current = () => (embedded ? signIn() : exchange({ demo: true, as: demoView() }).then(apply));
  }, [embedded, signIn, apply]);

  // The "show only" filter (industry and/or owner) narrows every page for agencies.
  const [filter, setFilter] = useState<{ industry: string; owner: string; hideTest: boolean }>({ industry: "", owner: "", hideTest: false });
  const filterQuery = [filter.industry && `industry=${encodeURIComponent(filter.industry)}`, filter.owner && `owner=${encodeURIComponent(filter.owner)}`, filter.hideTest && "hideTest=1"].filter(Boolean).join("&");
  const baseApi = auth.status === "ready" ? auth.api : null;
  useBrandedText(auth.status === "ready" ? auth.brand.name : null);
  const api = useMemo(() => (baseApi ? (filterQuery ? baseApi.filtered(filterQuery) : baseApi) : null), [baseApi, filterQuery]);

  // Count which pages get opened, so the getting-started checklist can tick itself off.
  useEffect(() => {
    if (api) void api.post("usage", { view: view.id }).catch(() => {});
  }, [api, view.id]);

  if (auth.status === "waiting") return <Centered title="Loading SubSync" body="Checking your account..." />;
  if (auth.status === "outside") {
    return <Centered title="Open SubSync from your account menu" body="This page is built to run inside your account. Open SubSync from the left menu of one of your client accounts." />;
  }
  if (auth.status === "maintenance") return <Centered title="Back shortly" body={auth.message} />;
  if (auth.status === "not_installed") {
    return <Centered title="SubSync is not set up for your company yet" body="Install SubSync from the app marketplace for your company, then open it again from the menu." />;
  }
  if (auth.status === "error" || !api) {
    return <Centered title="We could not sign you in" body={auth.status === "error" ? auth.message : "Please refresh."} />;
  }

  const limited = auth.kind !== "agency";
  // Features that are switched off (flags) are not shown at all.
  // Switched off for everyone: not shown. Locked by plan: shown with a Pro note, and the page explains.
  const locked = (feature: string) => auth.locked.includes(feature);
  const off = (feature: string) => auth.features[feature] === false && !locked(feature);
  const menu = NAV.filter((n) => NAV_FOR[auth.kind].has(n.id) && !off(n.feature));
  const labelFor = (n: (typeof NAV)[number]) => (limited && n.id === "overview" ? "My account" : n.label);
  // Pages that live inside another page highlight their parent in the menu.
  const PARENT: Partial<Record<ViewId, ViewId>> = { account: "accounts", deals: "pipeline", email: "onboarding", alerts: "today" };
  const active = PARENT[view.id] ?? view.id;
  const agency = auth.demo ? "Demo Company" : limited ? "Your business" : "Your company";
  const own = auth.locationId;

  const pipeTabs = [{ label: "Forecast and stages", node: <><PipelineView /><DealMoves /></> }, { label: "Stale deals and hygiene", node: <DealsView /> }];
  const setupTabs = [{ label: "Setup checklists", node: <OnboardingView go={go} /> }, { label: "Email sender health", node: <EmailHealthView /> }, ...(limited ? [] : [...(off("setup_compare") ? [] : [{ label: "Compare setups", node: <SetupCompareView /> }]), ...(off("playbooks") ? [] : [{ label: "Industry playbooks", node: <PlaybooksView go={go} /> }])])];

  const content = (() => {
    // A business or a client sees its own account as the home page, never an accounts list.
    if (limited) {
      const id = view.id === "account" || (view.id === "today" && auth.kind === "client") ? "overview" : view.id;
      if (!NAV_FOR[auth.kind].has(id)) return <Centered title="Not available" body="This page is not part of your view of SubSync." />;
      if (id === "overview") return own ? <AccountDetailView key={own} locationId={own} go={go} agency={agency} limited /> : <Centered title="Open SubSync from inside your account" body="We could not tell which account you are in." />;
    }
    const feature = NAV.find((n) => n.id === view.id)?.feature;
    if (feature && off(feature)) return <Centered title="Not available" body="This page is switched off right now." />;
    if (feature && locked(feature)) return <Centered title="Part of the paid plan" body="This page is included in the Pro plan. Ask whoever manages your SubSync plan to upgrade, and it appears here straight away." />;
    switch (view.id) {
      case "today": return <TodayView go={go} />;
      case "audit": return <AuditView go={go} />;
      case "speed": return <SpeedView go={go} />;
      case "overview": return <OverviewView go={go} />;
      case "accounts": return <AccountsView go={go} />;
      case "account": return view.locationId ? <AccountDetailView key={view.locationId} locationId={view.locationId} go={go} agency={agency} /> : <AccountsView go={go} />;
      case "search": return <SearchView />;
      case "deals": return <Tabs key="pipe" start={1} tabs={pipeTabs} />;
      case "inbox": return <InboxView />;
      case "onboarding": return <Tabs key="setup" start={0} tabs={setupTabs} />;
      case "email": return <Tabs key="setup" start={1} tabs={setupTabs} />;
      case "duplicates": return <DuplicatesView />;
      case "alerts": return <AlertsView go={go} />;
      case "settings": return <SettingsView />;
      case "help": return <HelpView go={go} />;
      case "roadmap": return <RoadmapView />;
      case "pipeline": return <Tabs key="pipe" start={0} tabs={pipeTabs} />;
      case "team": return <TeamView />;
      case "appointments": return <Tabs key="appts" start={0} tabs={[{ label: "To do", node: <AppointmentsView go={go} /> }, { label: "Insights", node: <AppointmentInsights /> }]} />;
      case "meetings": return <MeetingsView />;
      case "cleanup": return <CleanupView />;
      case "leads": return <LeadsView />;
      case "calls": return <CallsView />;
      case "clients": return <ClientsView reports={!off("reports")} />;
    }
  })();

  return (
    <ApiProvider value={api}>
      <div className="dark flex min-h-screen bg-background text-foreground" style={auth.brand.color ? ({ "--primary": auth.brand.color, "--primary-foreground": onColour(auth.brand.color), "--sidebar-primary": auth.brand.color, "--sidebar-primary-foreground": onColour(auth.brand.color), "--ring": auth.brand.color } as React.CSSProperties) : undefined}>
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex print:hidden">
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-md"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h10a4 4 0 0 1 0 8H8" /><path d="M20 16H10a4 4 0 0 1 0-8h6" opacity="0.55" /></svg></span>
            <span className="text-[1.05rem] font-semibold tracking-tight text-sidebar-accent-foreground">{auth.brand.name ?? "SubSync"}</span>
          </div>
          <nav className="sidebar-scroll mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1" aria-label="Sections">
            {menu.map((n, i) => (
              <div key={n.id}>
                {n.group !== (menu[i - 1]?.group ?? null) && (n.group ? <p className="px-3 pb-1 pt-5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">{n.group}</p> : <div className="my-2 border-t border-sidebar-border" />)}
                <button type="button" onClick={() => go(n.id)} aria-current={n.id === active ? "page" : undefined}
                  className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.86rem] transition-colors ${n.id === active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"}`}>
                  {n.id === active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-sidebar-primary" />}
                  {(() => { const Icon = ICONS[n.id]; return Icon ? <Icon aria-hidden className={`size-[17px] shrink-0 ${n.id === active ? "text-sidebar-primary" : "opacity-70 group-hover:opacity-100"}`} /> : null; })()}
                  <span className="flex-1">{labelFor(n)}</span>
                  {locked(n.feature) && <span className="rounded-full bg-sidebar-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-primary">Pro</span>}
                </button>
              </div>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-sidebar-accent/50 px-3 py-2.5">
            <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-semibold text-sidebar-primary">{(auth.userName ?? "?").slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 text-xs leading-4"><span className="block truncate font-medium text-sidebar-accent-foreground">{auth.userName ?? "Signed in"}</span><span className="block text-sidebar-foreground/55">{auth.kind === "agency" ? "All client accounts" : auth.kind === "business" ? "Your business" : "Read-only view"}</span></span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {auth.demo && (
            <div className="border-b border-amber-500/20 bg-amber-400/15 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:text-amber-200 print:hidden" role="note">
              Demo mode: this is sample data for a fictional company, not real clients.
            </div>
          )}
          <nav className="flex gap-1 overflow-x-auto border-b p-2 md:hidden print:hidden" aria-label="Sections">
            {menu.map((n) => (
              <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${n.id === active ? "bg-primary font-medium text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground"}`}>{labelFor(n)}</button>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:px-10 sm:py-8">
            {auth.kind === "agency" && baseApi && <ApiProvider value={baseApi}><FilterBar filter={filter} onChange={setFilter} /></ApiProvider>}
            <FreshnessStrip />{content}
          </main>
        </div>
      </div>
    </ApiProvider>
  );
}

const ICONS: Record<string, LucideIcon> = {
  today: Sun, audit: ClipboardCheck, speed: Zap, overview: LayoutDashboard, inbox: Inbox, appointments: CalendarCheck, meetings: Mic, search: Search, pipeline: Kanban, leads: Target, calls: PhoneCall,
  accounts: Briefcase, clients: UserRound, team: Users, onboarding: Wrench, duplicates: Copy, cleanup: Eraser, settings: Settings, help: CircleHelp, roadmap: Sparkles,
};

function Tabs({ tabs, start }: { tabs: Array<{ label: string; node: React.ReactNode }>; start: number }) {
  const [i, setI] = useState(start);
  return (
    <div>
      <div className="mb-5 inline-flex gap-1 rounded-xl bg-muted p-1 print:hidden" role="tablist">
        {tabs.map(({ label }, n) => (
          <button key={label} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)}
            className={`rounded-lg px-3.5 py-1.5 text-sm transition-all ${n === i ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
      {tabs[i].node}
    </div>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
