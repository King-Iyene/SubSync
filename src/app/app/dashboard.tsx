"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NAV_FOR, type AccessKind } from "@/lib/access";
import { NAV, type GoFn, type ViewId } from "./nav";
import { ApiProvider, makeApi, type Api } from "./session";
import { Badge } from "./ui";
import { AccountDetailView } from "./views/account-detail";
import { AccountsView } from "./views/accounts";
import { AlertsView } from "./views/alerts";
import { AppointmentsView } from "./views/appointments";
import { CallsView } from "./views/calls";
import { ClientsView } from "./views/clients";
import { DealsView } from "./views/deals";
import { DuplicatesView } from "./views/duplicates";
import { EmailHealthView } from "./views/email-health";
import { HelpView } from "./views/help";
import { FreshnessStrip } from "./views/health-card";
import { InboxView } from "./views/inbox";
import { OnboardingView } from "./views/onboarding";
import { LeadsView } from "./views/leads";
import { OverviewView } from "./views/overview";
import { PipelineView } from "./views/pipeline";
import { DealMoves, TeamView } from "./views/people";
import { SearchView } from "./views/search";
import { SettingsView } from "./views/settings";
import { TodayView } from "./views/today";

type Auth =
  | { status: "waiting" }
  | { status: "outside" }
  | { status: "error"; message: string }
  | { status: "not_installed" }
  | { status: "ready"; api: Api; demo: boolean; userName: string | null; features: Record<string, boolean>; kind: AccessKind; locationId: string | null };

type SsoResponse = {
  error?: string;
  installed?: boolean;
  demo?: boolean;
  session?: string;
  kind?: AccessKind;
  user?: { userName?: string | null; activeLocation?: string | null };
  entitlements?: { features: Record<string, boolean> };
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
        userName: r.data.user?.userName ?? null, features: r.data.entitlements?.features ?? {},
        kind: r.data.kind ?? "agency", locationId: r.data.user?.activeLocation ?? null,
      });
      return r.data.session;
    }
    setAuth({ status: "error", message: r.data.error ?? "Could not sign you in." });
    return null;
  }, []);

  // Ask the host page for fresh encrypted user context and exchange it for a session.
  const signIn = useCallback(async (): Promise<string | null> => {
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
        else setAuth({ status: "outside" });
      }).catch(() => setAuth({ status: "outside" }));
    } else {
      // signIn only sets state after awaiting the host page's reply, never synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void signIn();
    }
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, apply, signIn]);

  const go: GoFn = useCallback((id, locationId) => {
    setView({ id, locationId });
    window.scrollTo({ top: 0 });
  }, []);

  // The API client asks for a fresh session through this when a request comes back 401.
  useEffect(() => {
    refreshRef.current = () => (embedded ? signIn() : exchange({ demo: true, as: demoView() }).then(apply));
  }, [embedded, signIn, apply]);

  const api = auth.status === "ready" ? auth.api : null;

  // Count which pages get opened, so the getting-started checklist can tick itself off.
  useEffect(() => {
    if (api) void api.post("usage", { view: view.id }).catch(() => {});
  }, [api, view.id]);

  if (auth.status === "waiting") return <Centered title="Loading SubSync" body="Checking your account..." />;
  if (auth.status === "outside") {
    return <Centered title="Open SubSync from your account menu" body="This page is built to run inside your account. Open SubSync from the left menu of one of your client accounts." />;
  }
  if (auth.status === "not_installed") {
    return <Centered title="SubSync is not set up for this agency yet" body="Install SubSync from the app marketplace for your agency, then open it again from the menu." />;
  }
  if (auth.status === "error" || !api) {
    return <Centered title="We could not sign you in" body={auth.status === "error" ? auth.message : "Please refresh."} />;
  }

  const limited = auth.kind !== "agency";
  const menu = NAV.filter((n) => NAV_FOR[auth.kind].has(n.id));
  const labelFor = (n: (typeof NAV)[number]) => (limited && n.id === "overview" ? "My account" : n.label);
  // Pages that live inside another page highlight their parent in the menu.
  const PARENT: Partial<Record<ViewId, ViewId>> = { account: "accounts", deals: "pipeline", email: "onboarding", alerts: "today" };
  const active = PARENT[view.id] ?? view.id;
  const locked = (feature: string) => auth.features[feature] === false;
  const agency = auth.demo ? "Demo Agency" : limited ? "Your business" : "Your agency";
  const own = auth.locationId;

  const pipeTabs = [{ label: "Forecast and stages", node: <><PipelineView /><DealMoves /></> }, { label: "Stale deals and hygiene", node: <DealsView /> }];
  const setupTabs = [{ label: "Setup checklists", node: <OnboardingView go={go} /> }, { label: "Email sender health", node: <EmailHealthView /> }];

  const content = (() => {
    // A business or a client sees its own account as the home page, never an accounts list.
    if (limited) {
      const id = view.id === "account" || (view.id === "today" && auth.kind === "client") ? "overview" : view.id;
      if (!NAV_FOR[auth.kind].has(id)) return <Centered title="Not available" body="This page is not part of your view of SubSync." />;
      if (id === "overview") return own ? <AccountDetailView key={own} locationId={own} go={go} agency={agency} limited /> : <Centered title="Open SubSync from inside your account" body="We could not tell which account you are in." />;
    }
    switch (view.id) {
      case "today": return <TodayView go={go} />;
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
      case "pipeline": return <Tabs key="pipe" start={0} tabs={pipeTabs} />;
      case "team": return <TeamView />;
      case "appointments": return <AppointmentsView go={go} />;
      case "leads": return <LeadsView />;
      case "calls": return <CallsView />;
      case "clients": return <ClientsView />;
    }
  })();

  return (
    <ApiProvider value={api}>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="hidden w-60 shrink-0 flex-col border-r p-4 md:flex print:hidden">
          <p className="px-2 text-lg font-semibold tracking-tight">SubSync</p>
          <nav className="mt-6 flex flex-col gap-0.5" aria-label="Sections">
            {menu.map((n) => (
              <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${n.id === active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                {labelFor(n)}
                {locked(n.feature) && <Badge tone="info">Paid</Badge>}
              </button>
            ))}
          </nav>
          <p className="mt-auto px-2 pt-6 text-xs text-muted-foreground">{auth.userName ? `Signed in as ${auth.userName}` : "Signed in"}</p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {auth.demo && (
            <div className="border-b bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-800 dark:text-amber-200 print:hidden" role="note">
              Demo mode: this is sample data for a fictional agency, not real clients.
            </div>
          )}
          <nav className="flex gap-1 overflow-x-auto border-b p-2 md:hidden print:hidden" aria-label="Sections">
            {menu.map((n) => (
              <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={n.id === active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1 text-sm ${n.id === active ? "bg-muted font-medium" : "text-muted-foreground"}`}>{labelFor(n)}</button>
            ))}
          </nav>
          <main className="flex-1 p-4 sm:p-8"><FreshnessStrip />{content}</main>
        </div>
      </div>
    </ApiProvider>
  );
}

function Tabs({ tabs, start }: { tabs: Array<{ label: string; node: React.ReactNode }>; start: number }) {
  const [i, setI] = useState(start);
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b print:hidden" role="tablist">
        {tabs.map(({ label }, n) => (
          <button key={label} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${n === i ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
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
