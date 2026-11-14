import Image from "next/image";
import Link from "next/link";
import { COMPANY } from "@/lib/company";
import { INSTALL_HREF } from "@/lib/site/config";
import "./site.css";

/** Every public page's frame: skip link, header with the real logo, footer. Server component, no client JavaScript. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <a className="skip" href="#main">Skip to the content</a>
      <header className="hdr">
        <div className="wrap">
          <Link href="/" className="brand" aria-label="SubSync home">
            <Image src="/brand/subsync-logo.png" alt="" width={36} height={36} priority />
            SubSync
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/#modules">What it does</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/support">Support</Link>
            <Link href="/trust">Trust</Link>
            <a className="btn btn-primary btn-sm" href={INSTALL_HREF}>Install SubSync</a>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="ftr">
        <div className="wrap cols">
          <div>
            <strong>SubSync</strong>
            <p style={{ maxWidth: "34ch", marginTop: 8 }}>Built in Nigeria for businesses and agencies everywhere. Made and run by {COMPANY.legalName}.</p>
          </div>
          <div>
            <strong>Product</strong>
            <ul>
              <li><Link href="/#modules">What it does</Link></li>
              <li><Link href="/pricing">Pricing</Link></li>
              <li><a href={INSTALL_HREF}>Install SubSync</a></li>
            </ul>
          </div>
          <div>
            <strong>Help</strong>
            <ul>
              <li><Link href="/support">Support</Link></li>
              <li><Link href="/support/getting-started">Getting started</Link></li>
              <li><Link href="/support/glossary">Glossary</Link></li>
              <li><Link href="/support/changelog">Change log</Link></li>
            </ul>
          </div>
          <div>
            <strong>Company</strong>
            <ul>
              <li><Link href="/trust">Trust</Link></li>
              <li><Link href="/privacy">Privacy</Link></li>
              <li><Link href="/terms">Terms</Link></li>
              <li><a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a></li>
            </ul>
          </div>
        </div>
        <div className="wrap" style={{ marginTop: 28 }}>&copy; 2026 {COMPANY.legalName}. All rights reserved.</div>
      </footer>
    </div>
  );
}
