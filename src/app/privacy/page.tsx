import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy | SubSync" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="28 October 2026">
      <p>
        SubSync is operated by KD Squares Ltd (&quot;we&quot;, &quot;us&quot;).
        This policy explains what information SubSync handles when an agency
        installs it and connects its client accounts.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Installation data:</strong> the agency identifier and the
          access tokens needed to read data from the agency&apos;s connected
          client accounts. Tokens are encrypted at rest.
        </li>
        <li>
          <strong>Client account data:</strong> a list of client accounts and,
          for each, a limited copy of contact fields (name, email, phone, tags,
          dates) and deal fields (pipeline, stage, value, status, dates). We
          store only what our features need.
        </li>
        <li>
          <strong>Usage and diagnostics:</strong> basic technical logs such as
          errors and sync status. Logs never contain access tokens.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use this information only to provide SubSync&apos;s features:
        cross-account search, data health reports, stale deal alerts and
        onboarding progress. We do not sell this data and we do not use it for
        advertising.
      </p>

      <h2>Where it is stored</h2>
      <p>
        Data is stored in a managed database with access restricted to our
        servers. Our hosting and database providers act as processors on our
        behalf.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        When an agency uninstalls SubSync we stop syncing and delete that
        agency&apos;s cached data and access tokens. You can also ask us to
        delete your data at any time by emailing code@kdsquares.com.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        The contact data we process belongs to the agency and its clients. The
        agency is responsible for having a lawful basis to process it and for
        responding to requests from the individuals concerned. We will help
        where we can.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: code@kdsquares.com. KD Squares Ltd.
      </p>
    </LegalPage>
  );
}
