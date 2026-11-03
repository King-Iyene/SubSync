import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LegalPage } from "@/components/legal-page";
import { deleteMyDataText, storeLines, uninstallText } from "@/lib/data-inventory";
import { featureOn } from "@/lib/flags";

export const metadata: Metadata = { title: "Privacy Policy | SubSync" };

// A plain-words draft of what SubSync reads and stores. It must be reviewed by a person before the app goes public (it handles other
// businesses' customer data); docs/features/Z3.md lists this as an open item.
// The lists of what is stored and what is deleted are produced from src/lib/data-inventory.ts, which a test checks against the real database
// schema, so this page cannot name less than the database holds. The only thing read per request is the global switch for Zoom and Google Meet.
export default function Privacy() {
  return (
    <Suspense fallback={<LegalPage title="Privacy Policy" updated="1 November 2026"><p>Loading.</p></LegalPage>}>
      <PrivacyBody />
    </Suspense>
  );
}

async function PrivacyBody() {
  await connection();
  const zoomMeet = await featureOn("zoom_meet");
  return (
    <LegalPage title="Privacy Policy" updated="1 November 2026">
      <p>
        SubSync is operated by KD Squares Ltd (&quot;we&quot;, &quot;us&quot;).
        This policy explains what information SubSync handles when a company
        installs it and connects its client accounts. It is a draft that has
        not yet been reviewed by a lawyer.
      </p>

      <h2>What we read and store</h2>
      <p>
        This list is produced from the database itself, table by table, and checked by an automatic test that fails when the database holds
        something that is not on it.
      </p>
      <ul>
        {storeLines({ meetings: true }).map((l) => (
          <li key={l.id}>
            <strong>{l.title}:</strong> {l.text}
          </li>
        ))}
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
        processors on our behalf. If you connect {zoomMeet ? "Slack, Zoom or Fathom" : "Slack or Fathom"}, the
        information you choose to send goes to or comes from that service under its
        own terms. Emails carry a link to stop them.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Settings has a &quot;Delete my data&quot; button, which only the owner of the company account can press. {deleteMyDataText()}
      </p>
      <p>
        {uninstallText()} You can also ask us to delete your data at any time by emailing code@kdsquares.com.
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
