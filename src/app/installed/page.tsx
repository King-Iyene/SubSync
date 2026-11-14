import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRedirect } from "@/components/site/auto-redirect";
import { SiteShell } from "@/components/site/shell";
import { VideoPlayer } from "@/components/site/video-player";
import { COMPANY } from "@/lib/company";
import { crmTarget, readLanding } from "@/lib/install-landing";
import { CRM_WRITE_SUMMARY } from "@/lib/meeting-wording";
import { SCOPE_GROUPS } from "@/lib/scope-groups";
import { PRICING } from "@/lib/site/config";

export const metadata: Metadata = { title: "SubSync is installed", robots: { index: false, follow: false } };

type Step = { title: string; image?: { src: string; alt: string; note: string; w: number; h: number }; text: string; see: string; missing: string; guide: string; guideTitle: string };
const STEPS: Step[] = [
  { title: "Open SubSync", image: { src: "/site/install-menu.webp", alt: "SubSync's own menu with an arrow pointing at Today", note: "Example: SubSync's own menu once it is open.", w: 520, h: 1180 },
    text: "In your CRM, open any account and click SubSync in the left menu (it has a chart icon). If you installed for a whole company, open any one of its accounts first.", see: "SubSync opens on Today, with its own menu on the left.", missing: "If SubSync is not in the menu, the owner of the account may need to switch it on, or you may need to reinstall.", guide: "getting-started", guideTitle: "Getting started" },
  { title: "The first sync runs in the background",
    text: "SubSync reads your accounts for the first time. It usually takes a few minutes, and a big account keeps filling in while you look around.", see: "Numbers appear as each account finishes. A badge near the top says Live and Updated just now when it is up to date. Settings, Sync status shows progress.", missing: "If a page says Needs permission: reconnect, a permission was not approved. See the section on permissions below.", guide: "settings-sync", guideTitle: "Settings: Sync status" },
  { title: "Read Today", image: { src: "/site/today-800.webp", alt: "The Today page of SubSync with demo data", note: "Demo data, not your account.", w: 800, h: 450 },
    text: "Today lists what needs you first, with the reason. The Money at risk card adds up the value of open deals that have gone quiet. It is an estimate, and How this is worked out shows the formula.", see: "Cards for money at risk, no-shows to rebook and appointments to confirm, then your accounts to save.", missing: "A new account says still learning for a few days, because changes are judged against that account's own last week.", guide: "today", guideTitle: "Today" },
  { title: "Pick your date range", image: { src: "/site/install-range.webp", alt: "The date range buttons at the top of Today", note: "The range buttons sit at the top of every page.", w: 1368, h: 140 },
    text: "Choose Today, Yesterday, 7 days, 30 days, 90 days or a custom range at the top of the page.", see: "Every number on the page follows your choice and says which dates it used.", missing: "A custom range can be at most 366 days and not in the future.", guide: "today", guideTitle: "Today" },
  { title: "Save your alert email, and connect your own AI (optional)",
    text: "Under Settings, Notifications, save the email address that receives alerts and your daily brief. Under Settings, Integrations you can connect your own AI account. It is optional, and SubSync never pays for it.", see: "Send me a test shows what an email looks like. With no address saved, no emails are sent.", missing: "Only an administrator can connect AI or Slack.", guide: "settings-notifications", guideTitle: "Settings: Notifications" },
  { title: "Connect Slack and Fathom (optional)", image: { src: "/site/meeting-notes-800.webp", alt: "The Meeting notes page of SubSync with demo data", note: "Demo data: recorded calls on the right contact.", w: 800, h: 450 },
    text: "An administrator can connect one Slack channel for the whole team. Each person can connect their own Fathom, and nobody else can see it.", see: "Slack gets alerts and the daily brief. Fathom summaries land on a contact only when the match is certain, otherwise they wait in your private inbox.", missing: "Both are optional: skip them for now and come back any time.", guide: "connections", guideTitle: "Connections" },
  { title: "Set roles for setters and closers", image: { src: "/site/team-800.webp", alt: "The Team page of SubSync with demo data", note: "Demo data.", w: 800, h: 450 },
    text: "Open Team, Roles and label each person Setter, Closer, Both, Support or Manager. Roles stay inside SubSync.", see: "Lists and scorecards make sense for each person.", missing: "A client's own staff do not see this page.", guide: "roles", guideTitle: "Roles" },
  { title: "Tick off the Getting started checklist", image: { src: "/site/install-checklist.webp", alt: "SubSync's own menu with an arrow pointing at Getting started", note: "Example: the entry is near the bottom of SubSync's menu.", w: 520, h: 1180 },
    text: "Getting started inside SubSync is a checklist that ticks itself off from what you really did.", see: "A progress bar, and a button on each step that opens the right page.", missing: "Optional steps can be skipped.", guide: "getting-started", guideTitle: "Getting started" },
];

// The signed details arrive in the address, so the page is read per request. The frame (Suspense) keeps the rest of the build static.
export default function Installed({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SiteShell><div className="wrap page narrow"><h1>SubSync is installed</h1><p className="muted">Getting your next steps ready.</p></div></SiteShell>}>
      <InstalledBody searchParams={searchParams} />
    </Suspense>
  );
}

async function InstalledBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.v) ? sp.v[0] : sp.v;
  let landing = null;
  try { landing = readLanding(raw); } catch { landing = null; }
  // The page never holds the CRM address itself: the button goes through /api/open-crm, which checks the signed details and sends the person on.
  const target = crmTarget(landing);
  const openHref = landing && raw ? `/api/open-crm?v=${encodeURIComponent(raw)}` : "/api/open-crm";
  const required = SCOPE_GROUPS.flatMap((g) => g.scopes.filter((s) => s.required).map((s) => ({ ...s, group: g.title })));
  const optional = SCOPE_GROUPS.flatMap((g) => g.scopes.filter((s) => !s.required).map((s) => ({ ...s, group: g.title })));
  return (
    <SiteShell>
      <section className="hero" style={{ paddingBottom: 12 }}>
        <div className="wrap">
          <Image src="/brand/subsync-logo.png" alt="SubSync" width={96} height={96} priority style={{ margin: "0 auto" }} />
          <p className="eyebrow" style={{ marginTop: 12 }}>Installed</p>
          <h1 style={{ maxWidth: "20ch" }}>SubSync is installed and your accounts are connected</h1>
          <ol aria-label="Progress" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", listStyle: "none", padding: 0, margin: "18px 0 0" }}>
            {["Installed", "Open SubSync", "First sync", "Set up (5 min)"].map((s, i) => (
              <li key={s} className="tag" aria-current={i === 1 ? "step" : undefined} style={i === 0 ? { background: "var(--s-accent)", color: "var(--s-accent-text)", borderColor: "transparent", fontWeight: 700 } : i === 1 ? { borderColor: "var(--s-accent)", color: "var(--s-text)", fontWeight: 700 } : undefined}>
                {i === 0 ? "✓ " : `${i + 1}. `}{s}
              </li>
            ))}
          </ol>
          <div className="cta-row">
            <a className="btn btn-primary" href={openHref}>Open SubSync in your CRM</a>
            <a className="btn btn-ghost" href="#menu">Where is SubSync in my CRM menu?</a>
          </div>
          {target.auto && <AutoRedirect href={openHref} />}
        </div>
      </section>

      <section className="block" id="menu" aria-labelledby="menu-h" style={{ paddingTop: 36 }}>
        <div className="wrap narrow">
          <h2 className="h2" id="menu-h">Where is SubSync in my CRM menu?</h2>
          <p className="sub">Open any one of your accounts in your CRM. In the left menu, click SubSync (it has a chart icon). Once it opens, SubSync has its own menu, like the example in step 1 below. We do not show a picture of your CRM here because every CRM looks a little different.</p>
        </div>
      </section>

      <section className="block alt" aria-labelledby="start-h">
        <div className="wrap narrow">
          <h2 className="h2" id="start-h">Get started in 5 minutes</h2>
          <ol style={{ listStyle: "none", padding: 0, margin: "24px 0 0" }}>
            {STEPS.map((s, i) => (
              <li key={s.title} className="card" style={{ marginBottom: 16 }}>
                <h3 id={`step-${i + 1}`}><span className="eyebrow" style={{ display: "block" }}>Step {i + 1}</span>{s.title}</h3>
                <p style={{ margin: "10px 0" }}>{s.text}</p>
                {s.image && (
                  <figure style={{ margin: "14px 0" }}>
                    <div className="shot" style={{ maxWidth: s.image.h > 600 ? 260 : undefined }}>
                      <Image src={s.image.src} alt={s.image.alt} width={s.image.w} height={s.image.h} sizes="(min-width: 800px) 700px, 100vw" />
                    </div>
                    <figcaption className="fine">{s.image.note}</figcaption>
                  </figure>
                )}
                <p><strong>What you will see.</strong> <span className="muted">{s.see}</span></p>
                <p><strong>If you do not see it.</strong> <span className="muted">{s.missing}</span></p>
                <p style={{ marginTop: 10 }}><Link href={`/support/${s.guide}`}>Read the full guide: {s.guideTitle}</Link></p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="block" id="permissions" aria-labelledby="perm-h">
        <div className="wrap narrow">
          <h2 className="h2" id="perm-h">Permissions: what you just allowed</h2>
          <p className="sub">Each permission has a reason. Optional ones can be left off, and the feature that needs one says so instead of failing.</p>
          <h3 style={{ marginTop: 24 }}>Required</h3>
          <ul>{required.map((s) => <li key={s.scope}><strong>{s.group}.</strong> {s.why}</li>)}</ul>
          <h3 style={{ marginTop: 24 }}>Optional</h3>
          <ul>{optional.map((s) => <li key={s.scope}><strong>{s.group}.</strong> {s.why}</li>)}</ul>
          <h3 style={{ marginTop: 24 }}>What SubSync changes, and what it never does</h3>
          <ul>
            <li>{CRM_WRITE_SUMMARY}</li>
            <li>Anything else that changes your CRM shows a preview, waits for your confirmation, and is written to an audit log.</li>
            <li>It never copies the words of your customers&apos; messages, sends a message only when a person presses Send, and never deletes or merges people who asked not to be contacted.</li>
          </ul>
          <p><Link href="/trust">Read the full Trust page</Link></p>
        </div>
      </section>

      <section className="block alt" aria-labelledby="tour-h">
        <div className="wrap" style={{ maxWidth: 980 }}>
          <h2 className="h2" id="tour-h" style={{ textAlign: "center", marginBottom: 20 }}>Start here: a short welcome</h2>
          <VideoPlayer which="welcome" />
        </div>
      </section>

      <section className="block" aria-labelledby="help-h">
        <div className="wrap narrow">
          <h2 className="h2" id="help-h">Need to reinstall or update permissions?</h2>
          <p style={{ marginTop: 12 }}>If a page says Needs permission: reconnect, open your CRM&apos;s apps page, find SubSync and choose Reinstall (or Update), then approve the permission. Your data is kept. If SubSync is missing from the menu, ask the owner of the account to switch it on.</p>
          <p className="callout"><strong>Trial.</strong> {PRICING.trialDays} days free, then {PRICING.price} {PRICING.unit}. {PRICING.billing}</p>
          <p>Questions? Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. We reply within {COMPANY.supportReply}.</p>
          <p className="muted"><Link href="/support">Support</Link> &middot; <Link href="/trust">Trust</Link> &middot; <Link href="/privacy">Privacy</Link> &middot; <Link href="/terms">Terms</Link></p>
        </div>
      </section>
    </SiteShell>
  );
}
