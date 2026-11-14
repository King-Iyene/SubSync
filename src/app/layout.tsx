import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TODAY_FONTS } from "./app/views/today-fonts";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL((process.env.NEXT_PUBLIC_APP_URL || "https://subsync.kdsquares.com").replace(/\/+$/, "")),
  title: "SubSync",
  description: "Your command center for every client account. See what needs attention, what it is costing you and what to do next.",
  icons: { icon: [{ url: "/favicon.ico" }, { url: "/icon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/apple-touch-icon.png" },
  openGraph: { siteName: "SubSync", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "SubSync" }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${TODAY_FONTS} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
