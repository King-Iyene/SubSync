"use client";

export function PrintButton() {
  return <button type="button" className="no-print rp-print" onClick={() => window.print()}>Download or print (PDF)</button>;
}
