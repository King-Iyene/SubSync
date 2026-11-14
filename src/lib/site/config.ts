// One place for the facts the public site repeats: the address, the install link, the price. Nothing here is invented: the price is the Growth plan in
// src/lib/entitlements-core.ts and docs/PERMISSIONS_AND_PRICING.md, the support address is COMPANY.supportEmail, and the install link is the route the app already has.
import { COMPANY } from "../company.ts";

export const SITE = {
  name: "SubSync",
  url: (process.env.NEXT_PUBLIC_APP_URL || "https://subsync.kdsquares.com").replace(/\/+$/, ""),
  tagline: "Know what is happening in every account you manage before a customer tells you.",
  description: "SubSync watches every account you manage and tells you what needs attention first: leads nobody answered, appointments nobody marked, no-shows nobody called back, and deals that went quiet.",
  supportEmail: COMPANY.supportEmail,
  supportReply: COMPANY.supportReply,
} as const;

/** The one stable install address of the site (src/app/install/route.ts). It redirects to the marketplace listing or the install screen the app already builds. */
export const INSTALL_HREF = "/install";

export const PRICING = {
  plan: "Growth",
  amount: "11.50",
  price: "$11.50",
  unit: "per client account per month",
  trialDays: 14,
  billing: "Billed through the marketplace where you install SubSync. A price change applies to new installs only.",
} as const;

/** Where the tour video lives. The files are rebuilt by scripts/make-web-video.mjs, so the paths never change when the video does. */
export const VIDEO = {
  src720: "/video/subsync-tour-720.mp4",
  poster: "/video/subsync-tour-poster.jpg",
  captions: "/video/subsync-tour.en.vtt",
  title: "SubSync in 4 minutes",
  description: "A four-minute tour of SubSync: Today, Speed to lead, Appointments, Pipeline, Clients, the account audit, Clean-up and Alerts.",
  durationIso: "PT4M9S",
  uploadDate: "2026-11-13",
} as const;
