"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type SsoUser = {
  userId: string | null;
  companyId: string | null;
  role: string | null;
  type: string | null;
  userName: string | null;
  activeLocation: string | null;
};

type State =
  | { status: "waiting" }
  | { status: "error"; message: string }
  | { status: "ready"; user: SsoUser; installed: boolean | null };

const sections = [
  {
    id: "search",
    label: "Search",
    title: "Search every client account",
    empty:
      "Search contacts by name, email or phone across all of your client accounts. Available once the first sync finishes.",
  },
  {
    id: "health",
    label: "Data health",
    title: "Data health by client account",
    empty:
      "See missing emails, missing phones, untagged and inactive contacts for each account. Available once the first sync finishes.",
  },
  {
    id: "stale",
    label: "Stale deals",
    title: "Stale deals",
    empty:
      "Open deals that have not moved in 30, 60 or 90 days, across every pipeline. Available once the first sync finishes.",
  },
  {
    id: "onboarding",
    label: "Onboarding",
    title: "Client onboarding progress",
    empty:
      "Track which client accounts have a pipeline, contacts and a calendar set up. Available once the first sync finishes.",
  },
] as const;

export function Dashboard() {
  const [state, setState] = useState<State>({ status: "waiting" });
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("search");
  // The host page embeds us in an iframe. Without a parent frame there is nothing to ask.
  // Assume embedded during server render so the first paint matches.
  const embedded = useSyncExternalStore(
    () => () => {},
    () => window.parent !== window,
    () => true,
  );

  useEffect(() => {
    if (!embedded) return;

    let settled = false;

    async function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data as { message?: string; payload?: unknown } | null;
      if (!data || data.message !== "REQUEST_USER_DATA_RESPONSE") return;
      if (typeof data.payload !== "string") return;

      settled = true;
      try {
        const response = await fetch("/api/sso", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: data.payload }),
        });
        const body = await response.json();
        if (!response.ok) {
          setState({ status: "error", message: body.error ?? "Could not verify your account" });
          return;
        }
        setState({ status: "ready", user: body.user, installed: body.installed });
      } catch {
        setState({ status: "error", message: "Could not reach SubSync. Please refresh." });
      }
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");

    const timeout = window.setTimeout(() => {
      if (!settled) {
        setState({ status: "error", message: "No response from the host page. Please refresh." });
      }
    }, 6000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [embedded]);

  if (!embedded) {
    return (
      <Centered
        title="Open SubSync from your account menu"
        body="This page is built to run inside your account. Open SubSync from the left menu of one of your client accounts."
      />
    );
  }
  if (state.status === "waiting") {
    return <Centered title="Loading SubSync" body="Checking your account..." />;
  }
  if (state.status === "error") {
    return <Centered title="We could not sign you in" body={state.message} />;
  }

  const section = sections.find((s) => s.id === active) ?? sections[0];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-r p-4 sm:flex">
        <p className="px-2 text-lg font-semibold tracking-tight">SubSync</p>
        <nav className="mt-6 flex flex-col gap-1" aria-label="Sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-current={s.id === active ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                s.id === active
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{section.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.user.userName ? `Signed in as ${state.user.userName}` : "Signed in"}
            </p>
          </div>
          <StatusPill installed={state.installed} />
        </header>

        <nav className="mt-6 flex gap-2 overflow-x-auto sm:hidden" aria-label="Sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
                s.id === active ? "bg-muted font-medium" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <section className="mt-8 rounded-xl border border-dashed p-10 text-center">
          <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
            {section.empty}
          </p>
          <p className="mt-4 text-xs text-muted-foreground">Last synced: never</p>
        </section>
      </main>
    </div>
  );
}

function StatusPill({ installed }: { installed: boolean | null }) {
  const label =
    installed === true ? "Agency connected" : installed === false ? "Not installed" : "Status unknown";
  const tone =
    installed === true
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
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
