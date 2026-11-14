// Builds the public site's pictures from King's originals (kept outside git in assets/):
//   node scripts/make-site-assets.mjs [--assets <folder holding brand/ and listing/>]
// Output: public/site/*.webp (1600w and 800w screenshots), public/brand/* (logo files), public/icon-*.png, apple-touch-icon.png,
// src/app/favicon.ico, public/og.png (1200x630, used for Open Graph and Twitter). Needs sharp (already installed with Next.js).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--assets");
const assets = resolve(i > -1 ? process.argv[i + 1] : process.env.SUBSYNC_ASSETS ?? join(root, "assets"));
const pub = join(root, "public");
for (const d of ["site", "brand"]) mkdirSync(join(pub, d), { recursive: true });

const SHOTS = {
  "today": "01-today", "speed-to-lead": "02-speed-to-lead", "appointments": "03-appointments", "clients": "04-clients", "money": "05-money",
  "find-a-lead": "06-find-a-lead", "account-audit": "07-account-audit", "team": "08-team", "clean-up": "09-cleanup-duplicates", "meeting-notes": "10-meeting-notes",
  "pipeline-funnel": "11-pipeline-funnel", "pipeline-river": "12-pipeline-river", "appointments-flow": "17-appointments-flow-tree",
};
for (const [name, file] of Object.entries(SHOTS)) {
  const src = join(assets, "listing", "upload-ready", `${file}.png`);
  if (!existsSync(src)) { console.log("missing", src); continue; }
  await sharp(src).resize({ width: 1600 }).webp({ quality: 78 }).toFile(join(pub, "site", `${name}-1600.webp`));
  await sharp(src).resize({ width: 800 }).webp({ quality: 76 }).toFile(join(pub, "site", `${name}-800.webp`));
}

// The logo. The cut-out (transparent) file is the main mark; the white-background icon is for app icons and the touch icon.
const brand = join(assets, "brand");
const cut = existsSync(join(brand, "subsync-logo-main-transparent.png")) ? join(brand, "subsync-logo-main-transparent.png") : join(brand, "subsync-logo-main.png");
const icon = join(brand, "subsync-icon-white-1024.png");
const trimmed = await sharp(cut).trim().toBuffer();
const mark = (size) => sharp(trimmed).resize({ height: size, width: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 });
await mark(512).toFile(join(pub, "brand", "subsync-logo-512.png"));
await mark(256).toFile(join(pub, "brand", "subsync-logo.png"));
await sharp(join(brand, "subsync-logo-main.png")).resize(1024).png({ compressionLevel: 9 }).toFile(join(pub, "brand", "subsync-logo-main.png"));
await sharp(icon).resize(512).png({ compressionLevel: 9 }).toFile(join(pub, "brand", "subsync-icon-512.png"));

// Icons sit on a white square so they read on any tab colour; the S fills most of it.
const square = async (size) => {
  const inner = Math.round(size * 0.84);
  const s = await sharp(trimmed).resize({ height: inner, width: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } }).composite([{ input: s, gravity: "centre" }]).png({ compressionLevel: 9 });
};
for (const n of [32, 192, 512]) await (await square(n)).toFile(join(pub, `icon-${n}.png`));
await (await square(180)).toFile(join(pub, "apple-touch-icon.png"));

// favicon.ico: three PNG images in one ICO container (16, 32, 48).
const pngs = [];
for (const n of [16, 32, 48]) pngs.push({ n, buf: await (await square(n)).toBuffer() });
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const dir = pngs.map(({ n, buf }) => { const e = Buffer.alloc(16); e[0] = n; e[1] = n; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12); offset += buf.length; return e; });
writeFileSync(join(root, "src", "app", "favicon.ico"), Buffer.concat([head, ...dir, ...pngs.map((p) => p.buf)]));

// Open Graph / Twitter card, 1200x630: dark ground, the logo, the headline.
const logo = await sharp(trimmed).resize({ height: 430 }).png().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><radialGradient id="g" cx="25%" cy="40%" r="70%"><stop offset="0" stop-color="#12304d"/><stop offset="1" stop-color="#0b1220"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<text x="520" y="230" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#5cc0ee" letter-spacing="3">SUBSYNC</text>
<text x="520" y="320" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#f2f6ff">Know what is happening</text>
<text x="520" y="378" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#f2f6ff">in every account you manage,</text>
<text x="520" y="436" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#f2f6ff">before a customer tells you.</text></svg>`;
await sharp(Buffer.from(svg)).composite([{ input: logo, left: 110, top: 100 }]).png({ compressionLevel: 9 }).toFile(join(pub, "og.png"));
console.log("site assets built");
