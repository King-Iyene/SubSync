import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy | SubSync" };

// A plain-words draft of what SubSync reads and stores. It must be reviewed by a person before the app goes public (it handles other
// businesses' customer data); docs/features/Z3.md lists this as an open item.
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="31 October 2026">
      <p>
        SubSync is operated by KD Squares Ltd (&quot;we&quot;, &quot;us&quot;).
        This policy explains what information SubSync handles when a company
        installs it and connects its client accounts. It is a draft that has
        not yet been reviewed by a lawyer.
      </p>

      <h2>What we read and store</h2>
      <ul>
        <li>
          <strong>Installation data:</strong> the company identifier, the
          sign-in role of each person who opens SubSync (owner, admin, staff or
          client user, with no names or emails), and the access tokens needed to
          read data from the connected client accounts. Tokens are encrypted at
          rest.
        </li>
        <li>
          <strong>Contacts:</strong> name, email, phone, tags, source, whether
          they asked not to be contacted, and dates. No notes, files or custom
          fields.
        </li>
        <li>
          <strong>Deals:</strong> pipeline, stage, value, status, owner and dates.
        </li>
        <li>
          <strong>Conversations:</strong> only who wrote last, when, and through
          which channel. The text of messages is never copied. For new leads we
          also record when the lead arrived and when a person first replied, so
          reply speed can be measured.
        </li>
        <li>
          <strong>Appointments:</strong> time, status, calendar and the person it
          is assigned to.
        </li>
        <li>
          <strong>Things you add:</strong> team member names you type, call
          outcomes you log, a Slack address and an email address for alerts, your
          company name and colour, and settings.
        </li>
        <li>
          <strong>Meeting notes (optional, only if you connect a meeting tool):</strong>{" "}
          the meeting title, attendees, the summary and action items the tool
          sends. A full transcript is kept only if you switch that on in Settings.
          If you switch it on, a short note can also be added to the matched
          contact in your CRM.
        </li>
        <li>
          <strong>Share links:</strong> if you make an audit link, a snapshot of
          totals and finding titles with client names removed. It works for 14
          days and you can switch it off at any time.
        </li>
        <li>
          <strong>Records of what happened:</strong> a log of changes to deals and
          appointments that we start keeping once you install, an audit log of
          actions taken in the app (for example switching a link off), and basic
          technical logs such as errors and sync status. Logs never contain access
          tokens or message text.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use this information only to provide SubSync&apos;s features: speed to
        lead, appointment and inbox follow-up, account health, call lists, alerts,
        emails and shareable audits. We do not sell this data and we do not use it
        for advertising.
      </p>

      <h2>Who else handles it</h2>
      <p>
        Our hosting and database providers and our email provider act as
        processors on our behalf. If you connect Slack, Zoom or Fathom, the
        information you choose to send goes to or comes from that service under its
        own terms. Emails carry a link to stop them.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Settings has a &quot;Delete my data&quot; button that removes everything we
        copied from your accounts and keeps your settings. When a company uninstalls
        SubSync we stop syncing and delete its copied data, settings, connections and
        tokens. We keep a short audit record of actions, the record of plan and
        billing events, and the sign-in role log, none of which holds customer
        contacts, messages or credentials. You can also ask us to delete your data
        at any time by emailing code@kdsquares.com.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        The contact data we process belongs to the company and its clients. The
        company is responsible for having a lawful basis to process it and for
        responding to requests from the individuals concerned. We will help where we
        can.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: code@kdsquares.com. KD Squares Ltd.
      </p>
    </LegalPage>
  );
}
