import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site/shell";
import { COMPANY } from "@/lib/company";
import { INSTALL_HREF } from "@/lib/site/config";

export const metadata: Metadata = { title: "SubSync install problem", robots: { index: false, follow: false } };

export default function InstallError() {
  return (
    <SiteShell>
      <div className="wrap page narrow">
        <h1>We could not finish the install</h1>
        <p style={{ marginTop: 12 }}>Something went wrong while connecting your company. Nothing was changed on your accounts. Please try installing again, and if it keeps happening, email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. We reply within {COMPANY.supportReply}.</p>
        <p className="cta-row" style={{ justifyContent: "flex-start" }}>
          <a className="btn btn-primary" href={INSTALL_HREF}>Try the install again</a>
          <Link className="btn btn-ghost" href="/support">Read the Support pages</Link>
        </p>
      </div>
    </SiteShell>
  );
}
