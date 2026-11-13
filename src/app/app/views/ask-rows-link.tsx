"use client";

import { useEffect, useState } from "react";
import { takeBootParams } from "@/lib/design/boot-hash";
import { RowsDrawer } from "./ask-data";

// A link from a Slack answer ("#ask?rows=<address>&account=<id>&label=<words>") opens the exact rows behind the cited number, once. The person is signed in here with their
// own role, and the server rebuilds the rows for their own company and accounts, so a link never shows anything the person may not see.
export function AskRowsLinkHost() {
  const [open, setOpen] = useState<{ rows: string; account: string | null; label: string } | null>(null);
  useEffect(() => {
    const p = takeBootParams("ask");
    const rows = p?.get("rows");
    if (p && rows && rows.length <= 200) setTimeout(() => setOpen({ rows, account: p.get("account"), label: (p.get("label") ?? "Rows").slice(0, 80) }), 0);
  }, []);
  return open ? <RowsDrawer hash={open.rows} account={open.account} label={open.label} onClose={() => setOpen(null)} /> : null;
}
