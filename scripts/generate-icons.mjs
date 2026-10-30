// Generates the app icons from scripts/icon-source.jpg (run: node scripts/generate-icons.mjs)
import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og.js";
import React from "react";
import sharp from "sharp";

const SOURCE = "scripts/icon-source.jpg";
// The drawing inside the source, leaving out the byline underneath.
const ART = { left: 308, top: 465, width: 1268, height: 1002 };
const PAPER = { r: 255, g: 254, b: 250 };

/** The drawing centred on paper, `fill` of the icon's width. */
async function icon(size, fill) {
  const width = Math.round(size * fill);
  const art = await sharp(SOURCE).extract(ART).resize({ width }).toBuffer({ resolveWithObject: true });
  const x = Math.floor((size - art.info.width) / 2);
  const y = Math.floor((size - art.info.height) / 2);
  return sharp(art.data)
    .extend({ left: x, right: size - art.info.width - x, top: y, bottom: size - art.info.height - y, background: PAPER })
    .ensureAlpha()
    .png()
    .toBuffer();
}

// An .ico holding one PNG.
function ico(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

// Android shows the notification badge as a white silhouette, so it stays a simple sparkle.
const h = React.createElement;
const SPARKLE = "M12 1C12.7 7.3 16.7 11.3 23 12C16.7 12.7 12.7 16.7 12 23C11.3 16.7 7.3 12.7 1 12C7.3 11.3 11.3 7.3 12 1Z";

async function badge(size) {
  const star = (s, left, top, opacity) =>
    h("svg", { width: s, height: s, viewBox: "0 0 24 24", style: { position: "absolute", left, top } },
      h("path", { d: SPARKLE, fill: "#ffffff", opacity }));
  const res = new ImageResponse(
    h("div", { style: { width: "100%", height: "100%", display: "flex", position: "relative" } },
      star(size * 0.5, size * 0.22, size * 0.28, 1),
      star(size * 0.2, size * 0.6, size * 0.18, 0.85)),
    { width: size, height: size },
  );
  return Buffer.from(await res.arrayBuffer());
}

const targets = [
  ["public/icon-192.png", icon(192, 0.84)],
  ["public/icon-512.png", icon(512, 0.84)],
  // Maskable icons can be cropped to a circle, so the drawing stays inside the middle 80%.
  ["public/icon-maskable-512.png", icon(512, 0.62)],
  ["public/apple-touch-icon.png", icon(180, 0.84)],
  ["src/app/favicon.ico", icon(48, 0.92).then((png) => ico(png, 48))],
  ["public/badge.png", badge(96)],
];

for (const [file, data] of targets) {
  await writeFile(file, await data);
  console.log("wrote", file);
}
