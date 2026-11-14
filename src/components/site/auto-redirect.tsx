"use client";

import { useEffect, useState } from "react";

/** "Taking you there..." with a visible way to stay. Only drawn when the install gave us the details to build the link; it counts down 5 seconds, then goes. */
export function AutoRedirect({ href, seconds = 5 }: { href: string; seconds?: number }) {
  const [left, setLeft] = useState(seconds);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (stopped) return;
    if (left <= 0) { window.location.assign(href); return; }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, stopped, href]);
  if (stopped) return <p className="fine" role="status">Staying here. Use the button above whenever you are ready.</p>;
  return (
    <p className="fine" role="status" aria-live="polite">
      Taking you there in {Math.max(left, 0)}...{" "}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStopped(true)}>Stay on this page</button>
    </p>
  );
}
