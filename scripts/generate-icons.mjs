// Generates the PNG app icons in public/ (run: node scripts/generate-icons.mjs)
import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og.js";
import React from "react";

const h = React.createElement;

const TURQUOISE = "#22b8c8";
// Four-point sparkle in a 24x24 box.
const SPARKLE = "M12 1C12.7 7.3 16.7 11.3 23 12C16.7 12.7 12.7 16.7 12 23C11.3 16.7 7.3 12.7 1 12C7.3 11.3 11.3 7.3 12 1Z";

function sparkles(size, color) {
  const big = size * 0.5;
  const small = size * 0.2;
  return [
    h("svg", { key: "big", width: big, height: big, viewBox: "0 0 24 24", style: { position: "absolute", left: size * 0.22, top: size * 0.28 } },
      h("path", { d: SPARKLE, fill: color })),
    h("svg", { key: "small", width: small, height: small, viewBox: "0 0 24 24", style: { position: "absolute", left: size * 0.6, top: size * 0.18 } },
      h("path", { d: SPARKLE, fill: color, opacity: 0.85 })),
  ];
}

function icon(size, padded) {
  // Maskable icons get cropped to a circle, so keep the artwork in the inner 80%.
  const inner = padded ? size * 0.8 : size;
  return new ImageResponse(
    h(
      "div",
      { style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: TURQUOISE } },
      h("div", { style: { width: inner, height: inner, display: "flex", position: "relative" } }, ...sparkles(inner, "#ffffff")),
    ),
    { width: size, height: size },
  );
}

// Android shows the badge as a monochrome silhouette, so it's white on transparent.
function badge(size) {
  return new ImageResponse(
    h("div", { style: { width: "100%", height: "100%", display: "flex", position: "relative" } }, ...sparkles(size, "#ffffff")),
    { width: size, height: size },
  );
}

const targets = [
  ["public/icon-192.png", icon(192, false)],
  ["public/icon-512.png", icon(512, false)],
  ["public/icon-maskable-512.png", icon(512, true)],
  ["public/apple-touch-icon.png", icon(180, false)],
  ["public/badge.png", badge(96)],
];

for (const [file, res] of targets) {
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log("wrote", file);
}
