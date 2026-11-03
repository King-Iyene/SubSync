import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SubSync",
  // The mark: King's file first, the 512 picture until it exists.
  icons: { icon: [{ url: "/brand/subsync-logo.png", type: "image/png" }, { url: "/brand/subsync-logo-512.png", type: "image/png" }] },
  description:
    "One dashboard for all your client accounts. Search contacts, spot stale deals, check data quality and track onboarding across every account.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
