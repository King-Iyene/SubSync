// Covers parts of a screenshot with the page's own background colour (used to keep third-party tool names and the feedback footer out of frames).
// Usage: node scripts/video/mask.mjs <in.png> <out.png> x,y,w,h [x,y,w,h ...]   (1600x900 space)
import sharp from "sharp";
const [inp, out, ...rects] = process.argv.slice(2);
const { data, info } = await sharp(inp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
for (const r of rects) {
  const [x, y, w, h] = r.split(",").map(Number);
  const si = (Math.min(W - 2, 1570) + (y + Math.floor(h / 2)) * W) * 4;
  const c = [data[si], data[si + 1], data[si + 2]];
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const k = (j * W + i) * 4; data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255; }
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(out);
console.log("masked", out);
