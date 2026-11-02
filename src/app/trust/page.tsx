import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { COMPANY } from "@/lib/company";
import { trustMenu, trustSections, TRUST_UPDATED } from "@/lib/trust";

export const metadata: Metadata = { title: "Trust | SubSync" };

// Every sentence here comes from src/lib/trust.ts, where it is either produced from code that is tested against the database and the permission list,
// or is a claim with a proof that src/lib/__tests__/trust-truth.test.ts runs, or is a promise shown as a promise. Nothing is typed into this page by hand.
export default function Trust() {
  const sections = trustSections();
  return (
    <LegalPage title="Trust" updated={TRUST_UPDATED}>
      <p>
        {COMPANY.product} reads data about your clients and their customers, so you should be able to see exactly what it reads, what it keeps, why, and how to make it stop.
        This page says only what is true: where a sentence describes how the app behaves, an automatic test checks it against the code, and promises that no software can check are
        listed apart and called promises.
      </p>
      <nav aria-label="On this page" className="text-sm">
        <ul>
          {trustMenu().map((m) => <li key={m.id}><a className="underline underline-offset-4" href={`#${m.id}`}>{m.title}</a></li>)}
        </ul>
      </nav>
      {sections.map((s) => {
        const promises = s.items.filter((i) => i.kind === "commitment");
        const rest = s.items.filter((i) => i.kind !== "commitment");
        return (
          <section key={s.id} id={s.id} className="scroll-mt-6">
            <h2>{s.title}</h2>
            {s.intro && <p>{s.intro}</p>}
            {rest.length > 0 && (
              <ul>
                {rest.map((i) => <li key={i.title ?? i.text}>{i.title && <strong>{i.title}: </strong>}{i.text}</li>)}
              </ul>
            )}
            {promises.length > 0 && (
              <>
                <h3 className="mt-4 font-medium">What we promise</h3>
                <ul>
                  {promises.map((i) => <li key={i.text}>{i.text}</li>)}
                </ul>
              </>
            )}
          </section>
        );
      })}
      <p className="text-sm text-muted-foreground">
        Read next: <a className="underline underline-offset-4" href="/privacy">Privacy policy</a>, <a className="underline underline-offset-4" href="/terms">Terms</a>, <a className="underline underline-offset-4" href="/support">Support</a>.
        The privacy policy and terms are drafts that a lawyer has not reviewed yet.
      </p>
    </LegalPage>
  );
}
