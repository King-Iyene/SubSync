import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "SubSync" };

// The dashboard that is embedded as an iframe inside the host platform.
export default function EmbeddedApp() {
  return <Dashboard />;
}
