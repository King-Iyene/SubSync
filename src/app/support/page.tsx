import type { Metadata } from "next";
import Link from "next/link";
import { DocsSearch } from "@/components/site/docs-search";
import { SiteShell } from "@/components/site/shell";
import { VideoPlayer } from "@/components/site/video-player";
import { COMPANY } from "@/lib/company";
import { INSTALL_HREF } from "@/lib/site/config";
import { DOC_PAGES, searchIndex } from "@/lib/site/docs";

export const metadata: Metadata = {
  title: "Support and documentation | SubSync",
  description: "Every SubSync page and idea explained in plain words, from A to Z: speed to lead, appointments, pipeline, clean-up, alerts, connections, settings and safety.",
  alternates: { canonical: "/support" },
  openGraph: { title: "SubSync Support", description: "The A to Z guide to SubSync.", url: "/support", images: [{ url: "/og.png", width: 1200, height: 630 }] },
};

const QUICK: Array<[string, string]> = [
  ["Install", "Press Install SubSync and approve the permissions you are comfortable with."],
  ["Open it from your CRM", "Find SubSync in your CRM's left menu. You land on Today."],
  ["Save your email", "Settings, Notifications: so alerts and the daily brief can reach you."],
  ["Take your first look", "Read the top row of Today and deal with it."],
  ["Mark and call", "Mark unmarked appointments, then call the no-shows."],
];

export default function Support() {
  const az = [...DOC_PAGES].sort((a, b) => a.title.localeCompare(b.title));
  const letters = [...new Set(az.map((p) => p.title[0].toUpperCase()))];
  return (
    <SiteShell>
      <div className="wrap doc-hero">
        <p className="eyebrow">Support</p>
        <h1 style={{ fontSize: "clamp(32px,5vw,52px)", margin: "10px 0 12px" }}>Documentation and help</h1>
        <p className="muted" style={{ fontSize: 19, maxWidth: "58ch" }}>Every page and idea in SubSync, explained in plain words. The same guides are inside the app, behind the ? button.</p>
        <div style={{ marginTop: 22 }}><DocsSearch entries={searchIndex()} /></div>
      </div>

      <div className="wrap page" style={{ paddingTop: 8 }}>
        <h2 id="quick-start">Quick start: install, connect, first look in 5 minutes</h2>
        <ol>{QUICK.map(([t, b]) => <li key={t}><strong>{t}.</strong> {b}</li>)}</ol>
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
          <a className="btn btn-primary btn-sm" href={INSTALL_HREF}>Install SubSync</a>
          <Link className="btn btn-ghost btn-sm" href="/support/getting-started">Read the full getting started guide</Link>
        </p>

        <h2 id="install">How to install</h2>
        <ol>
          <li>Press Install SubSync. You are taken to the install screen of your CRM.</li>
          <li>Choose the account or accounts to connect and read the permissions. Required ones are needed for SubSync to work. Optional ones can be left off.</li>
          <li>Approve. SubSync starts its first read straight away.</li>
          <li>Open SubSync from your CRM&apos;s left menu.</li>
        </ol>

        <h2 id="video">Watch the 4-minute tour</h2>
        <div style={{ margin: "12px 0" }}><VideoPlayer /></div>

        <h2 id="a-to-z">All pages, A to Z</h2>
        <p className="muted">{letters.join("  ")}</p>
        <ul className="az">
          {az.map((p) => (
            <li key={p.slug}><Link href={`/support/${p.slug}`}>{p.title}<small>{p.group}</small></Link></li>
          ))}
        </ul>

        <h2 id="more">Also useful</h2>
        <ul>
          <li><Link href="/support/glossary">Glossary</Link>: setter, closer, show rate, stale deal and the other words, in plain language.</li>
          <li><Link href="/support/changelog">Change log</Link>: what is new, with dates.</li>
          <li><Link href="/trust">Trust</Link>, <Link href="/privacy">Privacy</Link> and <Link href="/terms">Terms</Link>: what we read, store and delete, and the rules.</li>
        </ul>

        <h2 id="contact">Contact us</h2>
        <p>Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. We reply within {COMPANY.supportReply}. Please include the page you were on and what you expected to see.</p>
        <p><strong>Report a problem.</strong> Inside the app, press Report a problem at the bottom of any page. It sends us the page you were on, so you do not have to describe it.</p>
        <p><strong>Security.</strong> To report a security problem, use the same address and put Security in the subject.</p>
      </div>
    </SiteShell>
  );
}
