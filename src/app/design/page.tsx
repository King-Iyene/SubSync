import type { Metadata } from "next";
import { DesignGuide } from "./design-guide";

// The style guide. Static, made-up data, no tenant data and no sign-in, and kept out of search results.
export const metadata: Metadata = { title: "SubSync style guide", robots: { index: false, follow: false } };

export default function DesignPage() {
  return <DesignGuide />;
}
