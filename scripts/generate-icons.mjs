// Generates the PNG app icons in public/ (run: node scripts/generate-icons.mjs)
import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og.js";
import React from "react";

const h = React.createElement;

function icon(size, padded) {
  const inner = padded ? size * 0.8 : size;
  return new ImageResponse(
    h(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
        },
      },
      h(
        "div",
        {
          style: {
            width: inner,
            height: inner,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: inner * 0.55,
          },
        },
        "🔔",
      ),
    ),
    { width: size, height: size },
  );
}

const targets = [
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/icon-maskable-512.png", 512, true],
  ["public/apple-touch-icon.png", 180, false],
  ["public/badge.png", 96, false],
];

for (const [file, size, padded] of targets) {
  const res = icon(size, padded);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log("wrote", file);
}
