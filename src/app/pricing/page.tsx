import type { Metadata } from "next";
import Link from "next/link";
import { PricingCalculator } from "@/components/site/pricing-calculator";
import { SiteShell } from "@/components/site/shell";
import { cost, dollars, margin, PRICE_CENTS } from "@/lib/site/pricing-calc";
import { INSTALL_HREF, PRICING, SITE } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "Pricing | SubSync",
  description: `One plan: ${PRICING.trialDays} days free, then ${PRICING.price} ${PRICING.unit}. Billed through your CRM marketplace.`,
  alternates: { canonical: "/pricing" },
  openGraph: { title: "SubSync pricing", description: `${PRICING.price} ${PRICING.unit}, ${PRICING.trialDays} days free.`, url: "/pricing", images: [{ url: "/og.png", width: 1200, height: 630 }] },
};

const INCLUDED = ["Today, with what needs you first", "Speed to lead and unanswered messages", "Appointments, true show rate and no-show recovery", "Pipeline and deals: funnel, river and replay", "Clients, health scores and shareable reports", "Money: payments and credit balance watchlist", "Find a lead, with smart lists", "Account audit and its history", "Clean-up and duplicates, always with a preview", "Team, roles and scorecards", "Meeting notes from your own Fathom", "Workflows check and the call queue", "Alerts in the app, by email and in Slack, and a daily brief"];

const FAQ: Array<[string, string]> = [
  ["Who pays?", "The business that installs SubSync pays for its own account. An agency that installs it for its clients pays per client account, and can charge its clients more. Billing happens in your CRM marketplace."],
  ["What happens after the trial?", `The ${PRICING.trialDays} days are free. After that the plan is billed through your CRM marketplace. If no plan is in place, your data is kept and nothing is deleted, and the pages that need the plan say so.`],
  ["Can I resell it?", "Yes. You set your own price for your clients and keep the difference. The calculator above shows an example."],
  ["What if I add an account?", `Each client account is one more account at the same price, ${PRICING.price} a month.`],
  ["Can I stop?", "Yes. Uninstalling cuts the connection at once and deletes what SubSync copied from your CRM."],
  ["Is there anything else to pay for?", "AI features are optional and use your own AI account, so that is between you and your AI provider. SubSync never takes payment itself."],
];

const ld = { "@context": "https://schema.org", "@type": "Product", name: "SubSync Growth plan", description: SITE.description, offers: { "@type": "Offer", price: PRICING.amount, priceCurrency: "USD", url: `${SITE.url}/pricing`, description: `${PRICING.price} ${PRICING.unit}, ${PRICING.trialDays}-day free trial` } };

export default function Pricing() {
  return (
    <SiteShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <section className="hero" style={{ paddingBottom: 12 }}>
        <div className="wrap">
          <p className="eyebrow">Pricing</p>
          <h1 style={{ maxWidth: "20ch" }}>One plan, one price per client account</h1>
          <p className="lede">{PRICING.trialDays} days free, then {PRICING.price} {PRICING.unit}. Billed through your CRM marketplace.</p>
          <div className="cta-row">
            <a className="btn btn-primary" href={INSTALL_HREF}>Install SubSync</a>
            <Link className="btn btn-ghost" href="/#tour">Watch the tour</Link>
          </div>
        </div>
      </section>

      <section className="block" aria-labelledby="plan-h">
        <div className="wrap">
          <div className="card price" style={{ marginTop: 0 }}>
            <p className="eyebrow" id="plan-h">{PRICING.plan}</p>
            <p className="amt">{PRICING.price}</p>
            <p style={{ color: "var(--s-muted)" }}>{PRICING.unit}</p>
            <ul>
              <li>{PRICING.trialDays}-day free trial</li>
              <li>{PRICING.billing}</li>
              <li>Uninstall any time</li>
              <li>Resell at your own price</li>
            </ul>
            <a className="btn btn-primary" href={INSTALL_HREF}>Install SubSync</a>
          </div>

          <h2 className="h2" style={{ marginTop: 56 }}>What is included</h2>
          <p className="sub">Everything below is live today. There are no tiers, so every page and alert is included for every client account.</p>
          <ul className="grid g3" style={{ listStyle: "none", padding: 0 }}>{INCLUDED.map((i) => <li className="card" key={i} style={{ padding: 16 }}>{i}</li>)}</ul>

          <h2 className="h2" style={{ marginTop: 56 }}>Examples</h2>
          <div className="grid g3">
            <div className="card"><h3>One business</h3><p>1 account is <strong>{dollars(cost(1))}</strong> a month after the free trial.</p></div>
            <div className="card"><h3>An agency with 20 client accounts</h3><p>20 x {dollars(PRICE_CENTS)} = <strong>{dollars(cost(20))}</strong> a month. If you charge each client $23, you collect {dollars(20 * 2300)} and keep <strong>{dollars(margin(20, 2300))}</strong>. This is an example, not a promise of what you will earn.</p></div>
          </div>
          <PricingCalculator />
        </div>
      </section>

      <section className="block alt" aria-labelledby="pfaq">
        <div className="wrap narrow">
          <h2 className="h2" id="pfaq">Pricing questions</h2>
          <div style={{ marginTop: 20 }}>{FAQ.map(([q, a]) => <details className="faq" key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
          <p style={{ marginTop: 24 }}>More: <Link href="/support/billing-and-plans">Billing and plans</Link>, <Link href="/terms#fees">Terms</Link>. Questions? <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.</p>
        </div>
      </section>
    </SiteShell>
  );
}
