import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/legal-doc";
import { COMPANY, PROCESSORS } from "@/lib/company";
import { deleteMyDataText, SHARE_LINK_DAYS, storeLines, uninstallText } from "@/lib/data-inventory";
import { SCOPE_GROUPS } from "@/lib/scope-groups";
import { DATA_LOCATION, LEGAL_UPDATED } from "@/lib/site/legal";
import { CLAIMS } from "@/lib/trust";

export const metadata: Metadata = {
  title: "Privacy Policy | SubSync",
  description: "What SubSync collects, why, how long it keeps it, who handles it, and your rights.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS = [
  { id: "who", title: "Who we are" }, { id: "collect", title: "What we collect" }, { id: "why", title: "What we read, and why" }, { id: "never", title: "What we never store" },
  { id: "retention", title: "How long we keep it" }, { id: "processors", title: "Who handles it" }, { id: "where", title: "Where it is stored" }, { id: "security", title: "How we protect it" },
  { id: "rights", title: "Your rights" }, { id: "cookies", title: "Cookies and local storage" }, { id: "children", title: "Children" }, { id: "changes", title: "Changes to this policy" }, { id: "contact", title: "Contact" },
];

const claim = (id: string) => CLAIMS.find((c) => c.id === id)?.text ?? "";

export default function Privacy() {
  return (
    <LegalDoc title="Privacy Policy" updated={LEGAL_UPDATED} sections={SECTIONS}
      intro={`This policy explains what ${COMPANY.product} handles when a business installs it, why, for how long, and what you can do about it. It is written in plain words. The Trust page shows the same facts with the proof behind them.`}>
      <section id="who" style={{ scrollMarginTop: 90 }}>
        <h2>Who we are</h2>
        <p>{COMPANY.product} is made and run by {COMPANY.legalName}. It is built in Nigeria and used by businesses and agencies in other countries. For the contact data SubSync reads from your CRM, you (the business that installs it) decide why it is processed and we process it for you, only to run SubSync. For account and usage information about your use of SubSync itself, we decide. Email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> for anything in this policy.</p>
      </section>

      <section id="collect" style={{ scrollMarginTop: 90 }}>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Account and install details.</strong> The names, time zones and contact details of the client accounts you connect, who installed SubSync, which plan or trial each account is on, whether it is paid up, and the role of the person who signs in.</li>
          <li><strong>Data we read from your CRM</strong>, only through the permissions you approve: contacts, conversations (who wrote, which way, which channel and when), appointments, deals and pipelines, team members, calendars, forms, workflows, payments and credit balance. The next section lists every permission and its purpose.</li>
          <li><strong>What SubSync works out and what you tell it.</strong> Daily counts, scores and history it records itself, and what you type into it: settings, notes, targets, roles, saved lists, feedback and problem reports.</li>
          <li><strong>Usage and error records.</strong> A record of what SubSync changed and who pressed the button, a sync history with any failures, page-view counts, and the sign-in role log. None of these hold your customers&apos; messages or credentials.</li>
        </ul>
        <details className="faq">
          <summary>The complete list of what is stored, table by table</summary>
          <p>This list is produced from the database itself, and an automatic test fails when the database holds something that is not on it.</p>
          <ul>{storeLines({ meetings: true }).map((l) => <li key={l.id}><strong>{l.title}:</strong> {l.text}</li>)}</ul>
        </details>
      </section>

      <section id="why" style={{ scrollMarginTop: 90 }}>
        <h2>What we read, and why</h2>
        <p>SubSync asks your CRM for the permissions below. Each has a reason. Optional permissions can be left off, and the feature that needs one then says so instead of failing. A permission marked change is used to change something only after a preview and your confirmation.</p>
        {SCOPE_GROUPS.map((g) => (
          <div key={g.id}>
            <h3>{g.title}</h3>
            <p className="muted">{g.summary}</p>
            <ul>{g.scopes.map((s) => <li key={s.scope}><strong>{s.scope}</strong> ({s.required ? "required" : "optional"}, {s.kind === "read" ? "read" : "change"}): {s.why}</li>)}</ul>
          </div>
        ))}
        <p>We use this information only to provide SubSync&apos;s features: speed to lead, appointment follow-up, unanswered messages, account health, call lists, alerts, summaries, reports and shareable audits. We do not sell it and do not use it for advertising.</p>
      </section>

      <section id="never" style={{ scrollMarginTop: 90 }}>
        <h2>What we never store</h2>
        <ul>
          <li>{claim("never_stored")} When a person sends a text or email from SubSync, we keep who, when, which channel, the result and a one-way fingerprint of the words, never the words themselves.</li>
          <li>Card numbers and bank details. SubSync reads the status and amount of payments, never a card or bank number.</li>
          <li>{claim("no_passwords")}</li>
          <li>Your AI provider key is kept encrypted and never shown again. If you connect your own AI account, what was sent and what came back are kept encrypted.</li>
        </ul>
      </section>

      <section id="retention" style={{ scrollMarginTop: 90 }}>
        <h2>How long we keep it</h2>
        <ul>
          <li>Everything is kept until you delete it or uninstall.</li>
          <li><strong>Uninstalling.</strong> Uninstalling cuts SubSync’s connection to your CRM at once and deletes what SubSync copied, on that same day, with nothing waiting in a queue.</li>
          <li><strong>Delete my data.</strong> Settings has a button for it. Only the owner of the company account can press it, and they must type the word DELETE. Every attempt, allowed or refused, is recorded.</li>
          <li>A share link stops working after {SHARE_LINK_DAYS} days. The list of notifications already handled is cleared after 3 days. A sign-in to connect your AI account lasts ten minutes at most.</li>
          <li>After deletion we keep only a short record of who did what and when, plan and billing events, and the sign-in role log. None of it holds customer contacts, messages or credentials.</li>
        </ul>
        <details className="faq">
          <summary>Exactly what Delete my data and uninstalling remove</summary>
          <p>{deleteMyDataText()}</p>
          <p>{uninstallText()}</p>
        </details>
      </section>

      <section id="processors" style={{ scrollMarginTop: 90 }}>
        <h2>Who handles it</h2>
        <p>These are the only outside services that handle data, and why. We do not use advertising or analytics trackers.</p>
        <ul>{PROCESSORS.map((p) => <li key={p.id}><strong>{p.name}.</strong> {p.role} <em>{p.whenUsed}</em></li>)}</ul>
        <p>{claim("ai_own")}</p>
      </section>

      <section id="where" style={{ scrollMarginTop: 90 }}>
        <h2>Where it is stored</h2>
        <p>{DATA_LOCATION} If you connect Slack, Fathom or your own AI provider, the information you choose to send goes to that service, under its own terms and in the places it keeps data.</p>
      </section>

      <section id="security" style={{ scrollMarginTop: 90 }}>
        <h2>How we protect it</h2>
        <ul>
          {["tokens_encrypted", "keys_hashed", "rls", "signed_sessions", "webhook_signed", "client_read_only", "isolation_tests", "settings_audit"].map((id) => <li key={id}>{claim(id)}</li>)}
          <li>Every change SubSync makes in your CRM is written to an audit log, and access to each screen depends on the role of the person signed in.</li>
        </ul>
        <p>See <Link href="/trust">Trust</Link> for how to report a security problem.</p>
      </section>

      <section id="rights" style={{ scrollMarginTop: 90 }}>
        <h2>Your rights</h2>
        <ul>
          <li><strong>Access.</strong> Everything SubSync shows you is the data it holds. Ask us by email for a copy of anything else.</li>
          <li><strong>Correction.</strong> SubSync copies from your CRM, so fix the record in your CRM and SubSync updates on its next read. Things you typed in SubSync can be edited there.</li>
          <li><strong>Deletion.</strong> Use Delete my data, uninstall, or email us.</li>
          <li><strong>Export.</strong> Lists can be exported as CSV from the pages that offer it. Email us for anything else.</li>
          <li><strong>People whose data is in a client&apos;s CRM.</strong> The business that holds your data decides how it is used. Ask that business first. We help them answer.</li>
        </ul>
        <p>Where the law of your country gives you more rights, we respect them.</p>
      </section>

      <section id="cookies" style={{ scrollMarginTop: 90 }}>
        <h2>Cookies and local storage</h2>
        <p>The SubSync app does not use cookies to sign you in: your session is held in memory because cookies are unreliable inside your CRM&apos;s frame. It uses your browser&apos;s own storage for conveniences only, such as your theme, which sections you folded and the last tab you opened. This website sets no cookies and has no advertising or analytics trackers.</p>
      </section>

      <section id="children" style={{ scrollMarginTop: 90 }}>
        <h2>Children</h2>
        <p>SubSync is a business tool and is not meant for children. We do not knowingly collect information from anyone under 16 about their use of SubSync.</p>
      </section>

      <section id="changes" style={{ scrollMarginTop: 90 }}>
        <h2>Changes to this policy</h2>
        <p>The date at the top says when this policy last changed. When a change matters, we say so in What&apos;s new inside the app and on the Support change log.</p>
      </section>

      <section id="contact" style={{ scrollMarginTop: 90 }}>
        <h2>Contact</h2>
        <p>{COMPANY.legalName}. <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. We reply within {COMPANY.supportReply}.</p>
      </section>
    </LegalDoc>
  );
}
