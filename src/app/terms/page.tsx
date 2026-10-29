import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of Service | SubSync" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="28 October 2026">
      <p>
        These terms govern your use of SubSync, provided by KD Squares Ltd
        (&quot;we&quot;, &quot;us&quot;). By installing or using SubSync you
        agree to them.
      </p>

      <h2>The service</h2>
      <p>
        SubSync gives agencies a single dashboard across their client accounts.
        We may improve, change or retire features over time and will try to
        give reasonable notice of material changes.
      </p>

      <h2>Your account and data</h2>
      <p>
        You are responsible for the access you grant, for keeping your
        credentials secure, and for having the right to connect the client
        accounts you add. You keep ownership of your data. You give us
        permission to process it only to run SubSync for you.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not misuse the service or try to access data you are not authorized to see.</li>
        <li>Do not attempt to disrupt, reverse engineer or overload the service.</li>
        <li>Follow the laws that apply to you, including those on marketing and privacy.</li>
      </ul>

      <h2>Fees</h2>
      <p>
        Paid plans are billed through the marketplace you installed SubSync
        from, at the price shown on the listing. Any free allowance and trial
        terms are shown there too.
      </p>

      <h2>Availability and liability</h2>
      <p>
        We work to keep SubSync available but provide it &quot;as is&quot;
        without guarantees. To the extent the law allows, we are not liable for
        indirect or consequential losses, and our total liability is limited to
        the fees you paid us in the previous twelve months.
      </p>

      <h2>Ending these terms</h2>
      <p>
        You can stop at any time by uninstalling SubSync. We may suspend or end
        access if these terms are broken. On uninstall we delete your cached
        data and access tokens.
      </p>

      <h2>Contact</h2>
      <p>code@kdsquares.com. KD Squares Ltd.</p>
    </LegalPage>
  );
}
