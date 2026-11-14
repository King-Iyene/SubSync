// Stills for the /installed onboarding page: crops of the real Today screenshot with a yellow arrow, so the guide can point at menu entries.
// They are EXAMPLES of SubSync's own menu, not pictures of the CRM, and the page says so.
//   node scripts/make-install-stills.mjs [--assets <folder holding listing/>]
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--assets");
const assets = resolve(i > -1 ? process.argv[i + 1] : process.env.SUBSYNC_ASSETS ?? join(root, "assets"));
const out = join(root, "public", "site");
const today = join(assets, "listing", "upload-ready", "01-today.png");
if (!existsSync(today)) throw new Error(`Missing ${today}`);

const side = await sharp(today).extract({ left: 0, top: 0, width: 232, height: 900 }).resize({ width: 464 }).toBuffer();
const sw = 464, sh = 1800, pad = 330;
const overlay = (y, label) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sw + pad}" height="${sh}">
<g fill="none" stroke="#ffd166" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M${sw + 150} ${y} L${sw - 6} ${y}"/><path d="M${sw + 14} ${y - 16} L${sw - 6} ${y} L${sw + 14} ${y + 16}"/></g>
<rect x="${sw + 156}" y="${y - 22}" rx="10" width="${pad - 166}" height="44" fill="#ffd166"/>
<text x="${sw + 168}" y="${y + 7}" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#1a1400">${label}</text></svg>`);
const make = async (name, y, label) => {
  await sharp({ create: { width: sw + pad, height: sh, channels: 4, background: "#0f1512" } })
    .composite([{ input: side, left: 0, top: 0 }, { input: overlay(y, label), left: 0, top: 0 }]).png().toBuffer()
    .then((buf) => sharp(buf).resize({ width: 520 }).webp({ quality: 82 }).toFile(join(out, `${name}.webp`)));
};
await make("install-menu", 142, "Start here");
await make("install-checklist", 1500, "Checklist");
await sharp(today).extract({ left: 232, top: 0, width: 1368, height: 140 }).webp({ quality: 82 }).toFile(join(out, "install-range.webp"));
console.log("install stills built");
