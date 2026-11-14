import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/legal-doc";
import { COMPANY } from "@/lib/company";
import { trustMenu, trustSections, TRUST_UPDATED } from "@/lib/trust";

export const metadata: Metadata = {
  title: "Trust | SubSync",
  description: "What SubSync reads, what it changes, what it keeps, who can see it and how to delete it, in plain words.",
  alternates: { canonical: "/trust" },
};

// Every sentence in the sections below comes from src/lib/trust.ts, where it is either produced from code that is tested against the database and the permission list,
// or is a claim with a proof that src/lib/__tests__/trust-truth.test.ts runs, or is a promise shown as a promise. The short proof at the top only restates those claims.
const PROOF: Array<[string, string]> = [
  ["SubSync reads, and changes things only after you confirm", "It changes things in your CRM only after a preview and a confirmation, writes every change to an audit log, and offers an undo where the page says one exists."],
  ["Messages to leads are off until you turn them on", "Texting or emailing a lead from SubSync exists behind a switch that is off until an owner turns it on for an account. It needs a preview and a press of Send, and it checks do-not-contact again before each send."],
  ["A short list of permissions, each with a reason", "Optional ones can be left off, and the feature that needs one says so instead of failing."],
  ["One account never sees another", "Automatic tests sign in as one company and try to read another's data. They must be refused on every release."],
  ["Personal tools stay personal", "A call recorded in Fathom belongs to the person who connected it. Admins see how many people connected, never anyone's content."],
  ["Customers' message words are never copied", "SubSync keeps who wrote, which way and when."],
  ["Your data can be deleted", "Uninstalling cuts the connection at once and deletes what SubSync copied. The owner can also press Delete my data."],
];

export default function Trust() {
  const sections = trustSections();
  const menu = [{ id: "proof", title: "The short version" }, ...trustMenu()];
  return (
    <LegalDoc title="Trust" updated={TRUST_UPDATED} sections={menu}
      intro={`${COMPANY.product} reads data about your business and your customers, so you should be able to see exactly what it reads, what it keeps, why, and how to make it stop. This page says only what is true today. Where a sentence describes how the app behaves, an automatic test checks it against the code.`}>
      <section id="proof" style={{ scrollMarginTop: 90 }}>
        <h2>The short version</h2>
        <ul>{PROOF.map(([t, b]) => <li key={t}><strong>{t}.</strong> {b}</li>)}</ul>
        <p className="callout">
          <strong>Security contact.</strong> To report a vulnerability or a security worry, email <a href={`mailto:${COMPANY.supportEmail}?subject=Security`}>{COMPANY.supportEmail}</a> with Security in the subject. We reply within {COMPANY.supportReply}.
        </p>
      </section>
      {sections.map((s) => {
        const promises = s.items.filter((i) => i.kind === "commitment");
        const rest = s.items.filter((i) => i.kind !== "commitment");
        return (
          <section key={s.id} id={s.id} style={{ scrollMarginTop: 90 }}>
            <h2>{s.title}</h2>
            {s.intro && <p>{s.intro}</p>}
            {rest.length > 0 && <ul>{rest.map((i) => <li key={i.title ?? i.text}>{i.title && <strong>{i.title}: </strong>}{i.text}</li>)}</ul>}
            {promises.length > 0 && (<><h3>What we promise</h3><ul>{promises.map((i) => <li key={i.text}>{i.text}</li>)}</ul></>)}
          </section>
        );
      })}
      <p className="muted" style={{ marginTop: 32 }}>
        Read next: <Link href="/privacy">Privacy policy</Link>, <Link href="/terms">Terms</Link>, <Link href="/support">Support</Link>.
      </p>
    </LegalDoc>
  );
}
