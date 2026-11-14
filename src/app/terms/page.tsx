import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/legal-doc";
import { COMPANY } from "@/lib/company";
import { PRICING } from "@/lib/site/config";
import { GOVERNING_LAW, LEGAL_UPDATED } from "@/lib/site/legal";

export const metadata: Metadata = {
  title: "Terms of Service | SubSync",
  description: "The rules for using SubSync: the service, plans and trial, acceptable use, your responsibilities, ours, and how it ends.",
  alternates: { canonical: "/terms" },
};

const SECTIONS = [
  { id: "service", title: "The service" }, { id: "accounts", title: "Accounts and installs" }, { id: "fees", title: "Free trial and pricing" }, { id: "use", title: "Acceptable use" },
  { id: "yours", title: "Your responsibilities" }, { id: "ours", title: "Our responsibilities" }, { id: "optional", title: "Optional features" }, { id: "data", title: "Your data" },
  { id: "confidential", title: "Confidentiality" }, { id: "third", title: "Third-party services" }, { id: "availability", title: "Availability" }, { id: "liability", title: "Disclaimers and liability" },
  { id: "ending", title: "Ending these terms" }, { id: "changes", title: "Changes to these terms" },
  ...(GOVERNING_LAW ? [{ id: "law", title: "Governing law" }] : []),
  { id: "contact", title: "Contact" },
];

export default function Terms() {
  return (
    <LegalDoc title="Terms of Service" updated={LEGAL_UPDATED} sections={SECTIONS}
      intro={`These terms are between ${COMPANY.legalName} (we, us) and the business that installs or uses ${COMPANY.product} (you). By installing or using ${COMPANY.product} you agree to them. If you install it for a company, you confirm you may do so for that company.`}>
      <section id="service" style={{ scrollMarginTop: 90 }}>
        <h2>The service</h2>
        <p>{COMPANY.product} reads the data in your CRM and shows you what needs attention: leads nobody answered, appointments with no outcome, no-shows, quiet deals, payments and more. It sends you alerts and summaries, and with your confirmation it can change things in your CRM.</p>
        <p>It is a monitoring and alerting tool, and it has limits. It can only see what your CRM shares with it and what you approved. Numbers are worked out from that data, and anything marked as an estimate is an estimate, not a promise of money gained or lost. A missed alert or an out-of-date number is possible, so do not rely on {COMPANY.product} as your only check on something that matters.</p>
      </section>

      <section id="accounts" style={{ scrollMarginTop: 90 }}>
        <h2>Accounts and installs</h2>
        <p>{COMPANY.product} is installed through the marketplace of your CRM. There is no separate sign-up and no password: you sign in through your CRM. You are responsible for the access you grant, for who on your team can open {COMPANY.product}, and for having the right to connect every account you add.</p>
      </section>

      <section id="fees" style={{ scrollMarginTop: 90 }}>
        <h2>Free trial and pricing</h2>
        <ul>
          <li>The {PRICING.plan} plan has a {PRICING.trialDays}-day free trial, then costs {PRICING.price} {PRICING.unit}.</li>
          <li>Billing is handled by the marketplace where you installed {COMPANY.product}. {COMPANY.product} never takes payment itself and never sees a card number.</li>
          <li>A change of price applies to new installs only. An existing install keeps the price it started on.</li>
          <li>If a trial ends without a plan, your data is kept and nothing is deleted, and the pages that need the plan say so.</li>
          <li>If you resell {COMPANY.product} to your own clients, you set your own price and you are responsible for your own customers.</li>
        </ul>
      </section>

      <section id="use" style={{ scrollMarginTop: 90 }}>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not try to see data you are not allowed to see, or to get around the limits between one company&apos;s data and another&apos;s.</li>
          <li>Do not disrupt, overload, copy or reverse engineer the service, or use it to build a competing product.</li>
          <li>Do not use it to send spam, to contact people who asked not to be contacted, or to break any law.</li>
          <li>Do not share a sign-in, API key or share link with someone who should not have it.</li>
        </ul>
      </section>

      <section id="yours" style={{ scrollMarginTop: 90 }}>
        <h2>Your responsibilities</h2>
        <ul>
          <li>You are responsible for having a lawful basis to hold and use the contact data in your CRM, and for answering the people it belongs to.</li>
          <li>If you use the features that text or email people, you are responsible for their consent and for following the messaging and marketing laws that apply to you. You must respect do-not-contact and opt-out requests. {COMPANY.product} checks do-not-contact again before each send, but the responsibility stays with you.</li>
          <li>If you record meetings, you must tell the people in them.</li>
          <li>Keep your own access secure and tell us quickly if you think it has been misused.</li>
        </ul>
      </section>

      <section id="ours" style={{ scrollMarginTop: 90 }}>
        <h2>Our responsibilities</h2>
        <p>We run {COMPANY.product} with reasonable care and skill, keep the protections described on the <Link href="/trust">Trust page</Link>, handle your data as the <Link href="/privacy">Privacy policy</Link> says, and answer support email within {COMPANY.supportReply}.</p>
      </section>

      <section id="optional" style={{ scrollMarginTop: 90 }}>
        <h2>Optional features</h2>
        <ul>
          <li><strong>AI.</strong> AI features are optional and use your own AI account and key, under your own agreement with that provider. We do not choose or pay for it. AI only suggests, and you decide.</li>
          <li><strong>Sending to leads.</strong> Texting or emailing a lead from {COMPANY.product} is off until an owner switches it on for an account. It needs a preview and a press of Send, and it is never done on its own.</li>
          <li><strong>Changes in your CRM.</strong> They need the optional permission, a preview and your confirmation, and are logged.</li>
          <li><strong>Connected tools.</strong> Slack, Fathom and similar tools are optional. A personal tool belongs to the person who connected it.</li>
        </ul>
      </section>

      <section id="data" style={{ scrollMarginTop: 90 }}>
        <h2>Your data</h2>
        <p>Your data stays yours. You allow us to process it only to run {COMPANY.product} for you. We do not sell it and do not use it for advertising. What we hold, why and for how long is in the <Link href="/privacy">Privacy policy</Link>.</p>
      </section>

      <section id="confidential" style={{ scrollMarginTop: 90 }}>
        <h2>Confidentiality</h2>
        <p>Each of us will keep the other&apos;s non-public information confidential and use it only for the purpose of this agreement, unless the law requires otherwise. Your CRM data is your confidential information.</p>
      </section>

      <section id="third" style={{ scrollMarginTop: 90 }}>
        <h2>Third-party services</h2>
        <p>{COMPANY.product} works with your CRM and, if you choose, with other services such as Slack, Fathom and an AI provider. Those services have their own terms, and we are not responsible for them or for changes they make.</p>
      </section>

      <section id="availability" style={{ scrollMarginTop: 90 }}>
        <h2>Availability</h2>
        <p>We work to keep {COMPANY.product} running, but we do not promise it will always be available or error-free, and we do not offer an uptime guarantee. Your CRM may limit how fast data can be read. We may pause the service for maintenance or to protect it.</p>
      </section>

      <section id="liability" style={{ scrollMarginTop: 90 }}>
        <h2>Disclaimers and liability</h2>
        <p>{COMPANY.product} is provided as it is, without guarantees of any particular result. To the extent the law allows, we are not liable for indirect or consequential loss, including lost leads, sales or profit, and our total liability to you is limited to the fees you paid for {COMPANY.product} in the twelve months before the claim. Nothing in these terms limits a liability that cannot be limited by law.</p>
      </section>

      <section id="ending" style={{ scrollMarginTop: 90 }}>
        <h2>Ending these terms</h2>
        <p>You can stop at any time by uninstalling {COMPANY.product}. Uninstalling cuts the connection to your CRM at once and deletes what {COMPANY.product} copied, as described in the <Link href="/privacy#retention">Privacy policy</Link>. We may suspend or end access if these terms are broken, or if keeping it running would put others at risk. We will tell you why where we can.</p>
      </section>

      <section id="changes" style={{ scrollMarginTop: 90 }}>
        <h2>Changes to these terms</h2>
        <p>The date at the top says when these terms last changed. When a change matters, we say so in What&apos;s new inside the app and on the Support change log. If you keep using {COMPANY.product} after a change, you accept it.</p>
      </section>

      {GOVERNING_LAW && (
        <section id="law" style={{ scrollMarginTop: 90 }}>
          <h2>Governing law</h2>
          <p>{GOVERNING_LAW}</p>
        </section>
      )}

      <section id="contact" style={{ scrollMarginTop: 90 }}>
        <h2>Contact</h2>
        <p>{COMPANY.legalName}. <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.</p>
      </section>
    </LegalDoc>
  );
}
