import { Hanken_Grotesk, IBM_Plex_Mono, Newsreader } from "next/font/google";

// Today's three faces, self-hosted by next/font at build time (so the page makes no request to a font server and needs no CSP change).
// Newsreader: the one headline sentence, section titles and the big figures. Hanken Grotesk: everything you read. IBM Plex Mono: labels and aligned figures.
// Each has a real fallback stack in today-theme.css.
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", weight: ["500", "600"], style: ["normal"], display: "swap" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", weight: ["400", "500", "600"], display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "500"], display: "swap" });

/** Class names that define the three font variables; the app wrapper carries them while Today is open. */
export const TODAY_FONTS = `${newsreader.variable} ${hanken.variable} ${plex.variable}`;
