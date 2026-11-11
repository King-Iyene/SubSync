"use client";

import type { Api } from "../../session";
import { useData } from "../../session";
import { NAV } from "../../nav";
import type { Cl2Meta } from "@/lib/analytics/clients2-types";

// The one place the Clients v2 screens read and write: GET /api/app/clients2?part=... and POST /api/app/clients2/<op>. Every answer carries Cl2Meta (flags, canSeeAccounts).
export type C2<T> = T & Cl2Meta;
export const c2q = (part: string, p: Record<string, string | number | boolean | null | undefined> = {}): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  return `clients2?${u.toString()}`;
};
export const useC2 = <T,>(query: string | null) => useData<C2<T>>(query);
export const c2post = <T,>(api: Api, op: string, body: unknown) => api.post<T>(`clients2/${op}`, body);

/** The Payments screen belongs to another module. Link to it only when it exists in the menu, so no dead button ever shows. */
export const hasPayments = (): boolean => NAV.some((i) => (i.id as string) === "payments");

export const money = (n: number, cur: string | null = "USD"): string => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch { return `${Math.round(n).toLocaleString("en-US")} ${cur ?? ""}`.trim(); }
};
export const dayText = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export const agoText = (iso: string | null): string => {
  if (!iso) return "Never";
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
export const copy = async (t: string): Promise<boolean> => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
