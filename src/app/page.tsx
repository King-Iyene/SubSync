import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteShell } from "@/components/site/shell";
import { VideoPlayer } from "@/components/site/video-player";
import { INSTALL_HREF, PRICING, SITE, VIDEO } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "SubSync: your command center for every client account",
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: { title: "SubSync", description: SITE.tagline, url: "/", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "SubSync" }] },
  twitter: { card: "summary_large_image", title: "SubSync", description: SITE.tagline, images: ["/og.png"] },
};

const PAIN: Array<[string, string]> = [
  ["Leads nobody answers", "A new lead writes in and waits. An hour later they are far less likely to reply. A week later they are gone."],
  ["Appointments nobody marks", "The time passes and nobody records showed or no-show, so your show rate is a guess."],
  ["No-shows nobody calls back", "People who missed sit in the calendar and slip away, with the money they were worth."],
  ["Deals that go quiet", "Good deals stop moving and fall out of the pipeline without anyone deciding to let them go."],
  ["Contacts that repeat", "The same person turns up again and again, and every report counts them twice."],
  ["Reports built by hand", "Every month you copy numbers into a document to prove the work, instead of doing it."],
  ["The customer finds out first", "Someone says they never heard back, and that is how you learn something was wrong."],
];

const MODULES: Array<{ slug: string; shot: string; name: string; line: string; bullets: string[] }> = [
  { slug: "today", shot: "today", name: "Today", line: "Start every morning with what needs you first, ranked, with the reason and a link to the person or deal.", bullets: ["The top row is the most urgent", "Proof lists what you cleared", "A 7 am brief by email"] },
  { slug: "speed-to-lead", shot: "speed-to-lead", name: "Speed to lead", line: "See how long every new lead waits for a first reply from a person, and which accounts are leaving leads unanswered.", bullets: ["Typical wait, not a flattering average", "Customer messages still waiting", "Hand waiting leads to your CRM's call queue"] },
  { slug: "appointments", shot: "appointments", name: "Appointments", line: "Find every booking nobody marked, get an honest show rate, and win back the no-shows.", bullets: ["Needs outcome list", "True show rate", "No-show recovery"] },
  { slug: "funnel-and-pipeline", shot: "pipeline-funnel", name: "Pipeline and deals", line: "A funnel that shows where deals leak, a river of money by step, and a replay of how deals moved.", bullets: ["Stale and stuck deals", "Deals without a value flagged", "Forecast only when there is enough data"] },
  { slug: "clients", shot: "clients", name: "Clients", line: "Every client account with its health, plan and what needs attention, plus monthly reports you can share.", bullets: ["Health score with reasons", "Notes and next steps", "Reports you can print or share"] },
  { slug: "money-and-wallet", shot: "money", name: "Money", line: "Failed, late and disputed payments in one place, and a watchlist of credit balances before they run out.", bullets: ["Chase the oldest failed payment", "Days of credit left", "Payout lines per setter and closer"] },
  { slug: "find-a-lead", shot: "find-a-lead", name: "Find a lead", line: "Search every contact in every account, save the lists you use, and open a person's whole story in one panel.", bullets: ["Filters and smart lists", "Timeline, deals and recorded calls", "Nothing sent without a preview"] },
  { slug: "account-audit", shot: "account-audit", name: "Account audit", line: "Problems found in each account and the money at risk, with counted facts kept apart from estimates.", bullets: ["History since the first audit", "A share link that hides client names", "Every estimate shows its formula"] },
  { slug: "clean-up", shot: "clean-up", name: "Clean-up", line: "Duplicate contacts and data problems, sorted by how sure SubSync is, always with a preview first.", bullets: ["Certain, likely, possible", "Protects people who asked not to be contacted", "Every change in History"] },
  { slug: "team", shot: "team", name: "Team", line: "Who replies fast, who is overloaded, and how each person compares with their own recent past.", bullets: ["Roles for setters and closers", "Scorecards per person", "Private coaching notes"] },
];

const STEPS: Array<[string, string]> = [
  ["Install once", "Press Install SubSync, approve the permissions you are comfortable with, and wait a few minutes for the first read."],
  ["Connect nothing else", "SubSync reads your CRM directly. Slack, your own AI and Fathom are optional extras, not setup."],
  ["See what needs attention", "Open Today. The most urgent thing is at the top, with the reason and a link."],
];

const FAQ: Array<[string, string]> = [
  ["Who is SubSync for?", "Agencies that manage many client accounts are our main users. It also fits any business with several accounts or locations, and a single business with one account. If leads, appointments and deals live in your CRM, SubSync watches them for you. Each person sees only the accounts they have access to."],
  ["Does it change anything in my CRM?", "Only after a preview and a confirm, with a log, and an undo where the page says one exists. Reading is the default, and every permission has a reason you can read."],
  ["Will it message my customers?", "Never on its own. Replying by text or email from SubSync exists behind a switch that is off until an owner turns it on for an account, and it checks do-not-contact again before each send. People who asked not to be contacted are never messaged."],
  ["What does it cost?", `${PRICING.trialDays} days free, then ${PRICING.price} ${PRICING.unit} on the ${PRICING.plan} plan. It is billed through the marketplace where you install it, never inside SubSync.`],
  ["Can a client account see another client's data?", "No. A client account can only see its own data, another company's data is never reachable, and automatic tests try to break this on every release."],
  ["Do I need an AI account?", "No. AI features are optional and use your own AI account, so SubSync never pays for AI and you control the spend. SubSync works out every number itself."],
  ["What happens to my data if I leave?", "Uninstalling cuts the connection at once and deletes what SubSync copied from your CRM. The Trust page lists exactly what is stored and what is deleted."],
  ["Do I have to connect Fathom or Slack?", "No. Fathom is connected by each person for their own calls, and Slack by an administrator for the team. Both are optional."],
  ["Does it work under my own brand?", "Yes. Add your name, colour and logo in Settings and they show on screens, reports and share links."],
  ["How do I get help?", `Read the Support pages, or email ${SITE.supportEmail}. We reply within ${SITE.supportReply}.`],
];

const ld = [
  {
    "@context": "https://schema.org", "@type": "VideoObject", name: VIDEO.title, description: VIDEO.description,
    thumbnailUrl: `${SITE.url}${VIDEO.poster}`, uploadDate: VIDEO.uploadDate, duration: VIDEO.durationIso, embedUrl: `https://www.youtube-nocookie.com/embed/${VIDEO.tour.youtubeId}`,
  },
  {
    "@context": "https://schema.org", "@type": "SoftwareApplication", name: "SubSync", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: SITE.description,
    offers: { "@type": "Offer", price: PRICING.amount, priceCurrency: "USD", description: `${PRICING.price} ${PRICING.unit}, ${PRICING.trialDays}-day free trial` },
  },
];

export default function Home() {
  return (
    <SiteShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">For agencies, multi-location businesses and single businesses</p>
          <h1>Your <span className="grad">command center</span> for every client account.</h1>
          <p className="lede">SubSync shows what needs attention, what it is costing you and what to do next, before a customer tells you. Leads nobody answered, appointments nobody marked, no-shows nobody called back and deals that went quiet. One account or a hundred.</p>
          <div className="cta-row">
            <a className="btn btn-primary" href={INSTALL_HREF}>Install SubSync</a>
            <a className="btn btn-ghost" href="#tour">Watch the 6-minute tour</a>
          </div>
          <p className="fine">{PRICING.trialDays} days free, then {PRICING.price} {PRICING.unit}.</p>
        </div>
      </section>

      <section className="video" aria-label="Product tour video">
        <div className="wrap" style={{ maxWidth: 980 }}>
          <VideoPlayer />
        </div>
      </section>

      <section className="block" aria-labelledby="who">
        <div className="wrap">
          <h2 className="h2" id="who">Made for the way you work</h2>
          <p className="sub">The same pages for everyone. What you see depends on the accounts you can open.</p>
          <div className="grid g3">
            <div className="card"><h3>Agencies</h3><p>See every client account on one screen, find the one that needs you first, and share a report with the client.</p></div>
            <div className="card"><h3>Businesses with several accounts</h3><p>Several locations, brands or teams? Compare them side by side and see which one is slipping.</p></div>
            <div className="card"><h3>Single businesses</h3><p>One account is enough. You see only that account, with the same alerts and guides.</p></div>
          </div>
        </div>
      </section>

      <section className="block" aria-labelledby="pain">
        <div className="wrap">
          <h2 className="h2" id="pain">The problems nobody sees until it is late</h2>
          <p className="sub">Workflows fail quietly, leads have no owner and people forget to mark what happened. SubSync is the independent check.</p>
          <div className="grid g3 pain">
            {PAIN.map(([t, b], i) => (
              <div className="card" key={t}><span className="n">0{i + 1}</span><h3>{t}</h3><p>{b}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="block alt" id="modules" aria-labelledby="mods">
        <div className="wrap">
          <h2 className="h2" id="mods">Ten pages, each one answers a question you ask every day</h2>
          <p className="sub">Real screens from a demo account. Every page has a short guide in the app and a full one on the Support pages.</p>
          {MODULES.map((m, i) => (
            <div className={`mod${i % 2 ? " flip" : ""}`} key={m.slug}>
              <div>
                <p className="eyebrow">{String(i + 1).padStart(2, "0")}</p>
                <h3>{m.name}</h3>
                <p>{m.line}</p>
                <ul>{m.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
                <Link className="more" href={`/support/${m.slug}`}>Read the guide to {m.name}</Link>
              </div>
              <div className="shot">
                <Image src={`/site/${m.shot}-1600.webp`} alt={`The ${m.name} page of SubSync, shown with demo data`} width={1600} height={900} sizes="(min-width: 900px) 58vw, 100vw" priority={i === 0} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="block" aria-labelledby="how">
        <div className="wrap">
          <h2 className="h2" id="how">How it works</h2>
          <div className="grid g3 steps">
            {STEPS.map(([t, b]) => <div className="card" key={t}><h3>{t}</h3><p>{b}</p></div>)}
          </div>
        </div>
      </section>

      <section className="block alt" id="pricing" aria-labelledby="price">
        <div className="wrap">
          <h2 className="h2" id="price" style={{ textAlign: "center" }}>One plan, one price</h2>
          <div className="card price">
            <p className="eyebrow">{PRICING.plan}</p>
            <p className="amt">{PRICING.price}</p>
            <p className="muted" style={{ color: "var(--s-muted)" }}>{PRICING.unit}</p>
            <ul>
              <li>{PRICING.trialDays}-day free trial</li>
              <li>Every page and alert, for every client account you connect</li>
              <li>{PRICING.billing}</li>
              <li>Resell it to your own clients at your own price</li>
            </ul>
            <a className="btn btn-primary" href={INSTALL_HREF}>Install SubSync</a>
            <p style={{ marginTop: 14 }}><Link href="/pricing">See the pricing details and the calculator</Link></p>
          </div>
        </div>
      </section>

      <section className="block" aria-labelledby="trust">
        <div className="wrap">
          <h2 className="h2" id="trust">What we read, what we keep, who can see it</h2>
          <div className="grid g3">
            <div className="card"><h3>A short, listed set of permissions</h3><p>Each has a plain reason. Optional ones can be left off and the feature that needs one says so.</p></div>
            <div className="card"><h3>Nothing changes without a preview</h3><p>Changes to your CRM show a preview, ask you to confirm, are logged, and can be undone where the page says so.</p></div>
            <div className="card"><h3>One account never sees another</h3><p>Tested automatically on every release. A client account sees only its own data.</p></div>
            <div className="card"><h3>We never copy message words</h3><p>SubSync keeps who wrote, which way, when. Not what they said.</p></div>
            <div className="card"><h3>Your data is deleted when you leave</h3><p>Uninstall cuts the connection at once and deletes what SubSync copied.</p></div>
            <div className="card"><h3>Your tools stay yours</h3><p>Your AI uses your own key. Fathom is connected by each person for their own calls.</p></div>
          </div>
          <p style={{ marginTop: 20 }}><Link href="/trust">Read the full Trust page</Link></p>
        </div>
      </section>

      <section className="block alt" aria-labelledby="faq">
        <div className="wrap narrow">
          <h2 className="h2" id="faq">Questions people ask</h2>
          <div style={{ marginTop: 20 }}>
            {FAQ.map(([q, a]) => (
              <details className="faq" key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </div>
      </section>

      <section className="block" aria-labelledby="final">
        <div className="wrap" style={{ textAlign: "center" }}>
          <h2 className="h2" id="final">Find out what is happening before your customers do</h2>
          <div className="cta-row">
            <a className="btn btn-primary" href={INSTALL_HREF}>Install SubSync</a>
            <Link className="btn btn-ghost" href="/support">Read the Support pages</Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
