// Cuts the white background and the grey drop shadow off the main logo, keeping its own colours (no recolouring).
// Usage: node scripts/video/logo-cutout.mjs <in.png> <out.png>
import sharp from "sharp";
const [inp, out] = process.argv.slice(2);
const { data, info } = await sharp(inp).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const o = Buffer.alloc(W * H * 4);
// The grey bezel round the gold link is part of the logo: keep greys inside this capsule.
const A = [440, 435], B = [540, 510], R = 54;
const dist = (x, y) => { const dx = B[0] - A[0], dy = B[1] - A[1]; let t = ((x - A[0]) * dx + (y - A[1]) * dy) / (dx * dx + dy * dy); t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (A[0] + t * dx), y - (A[1] + t * dy)); };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), chroma = mx - mn;
  let a = chroma >= 110 ? 1 : chroma < 5 ? 0 : Math.min(1, (chroma - 5) / 145);
  let R2 = r, G2 = g, B2 = b;
  if (a > 0 && a < 1) {
    const k = 255 * (1 - a);
    R2 = Math.max(0, Math.min(255, (r - k) / a)); G2 = Math.max(0, Math.min(255, (g - k) / a)); B2 = Math.max(0, Math.min(255, (b - k) / a));
  }
  if (dist(x, y) < R) { // bezel and gold link: keep opaque
    const ga = Math.max(0, Math.min(1, (236 - mn) / 14));
    if (ga > a) { a = ga; R2 = r; G2 = g; B2 = b; }
  }
  o[i] = R2; o[i + 1] = G2; o[i + 2] = B2; o[i + 3] = Math.round(a * 255);
}
await sharp(o, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out);
console.log("ok");
