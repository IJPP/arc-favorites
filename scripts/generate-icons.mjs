import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// "Fan": three app cards fanned around one pivot below them, so their top
// edges trace a bow. Drawn on a 128-unit grid. The side cards are cut away
// from the centre card by an even gap. Toolbar sizes show the bare mark in
// two blues; 48/128 put it in white on a blue gradient squircle.
const CORE = [63, 111, 242];
const WING = [122, 155, 249];
const TOP = [91, 141, 255];
const BOTTOM = [47, 95, 232];
const WHITE = [255, 255, 255];
const GAP = 5;

function roundedRect(x, y, width, height, radius) {
  return (u, v) => {
    if (u < x || u > x + width || v < y || v > y + height) return false;
    const cx = Math.min(Math.max(u, x + radius), x + width - radius);
    const cy = Math.min(Math.max(v, y + radius), y + height - radius);
    return (u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2;
  };
}

// Same as SVG's rotate(degrees cx cy) applied to a shape.
function rotated(shape, degrees, cx, cy) {
  const a = (-degrees * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return (u, v) => {
    const du = u - cx, dv = v - cy;
    return shape(cx + du * cos - dv * sin, cy + du * sin + dv * cos);
  };
}

const core = roundedRect(39, 26, 50, 62, 17);
const gap = roundedRect(39 - GAP, 26 - GAP, 50 + GAP * 2, 62 + GAP * 2, 17 + GAP);
const card = roundedRect(41, 30, 46, 58, 16);
const wings = [rotated(card, -30, 64, 112), rotated(card, 30, 64, 112)];
const wing = (u, v) => !gap(u, v) && wings.some((w) => w(u, v));

function mix(a, b, t) {
  return a.map((c, i) => c + (b[i] - c) * t);
}

// Each layer is [inside(u, v), color(u, v)]; later layers paint over earlier.
function layers(size) {
  if (size <= 32) {
    return [
      [wing, () => WING],
      [core, () => CORE],
    ];
  }
  const background = (v) => mix(TOP, BOTTOM, Math.min(Math.max((v - 8) / 112, 0), 1));
  // The mark sits at 20,20 scaled to 88 units inside the squircle.
  const inner = (shape) => (u, v) => shape(((u - 20) * 128) / 88, ((v - 20) * 128) / 88);
  return [
    [roundedRect(8, 8, 112, 112, 30), (u, v) => background(v)],
    [inner(wing), (u, v) => mix(background(v), WHITE, 0.62)],
    [inner(core), () => WHITE],
  ];
}

function makePng(size) {
  const rows = [];
  const shapes = layers(size);
  const samples = 6;

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      // Supersample each pixel so curves are antialiased.
      let r = 0, g = 0, b = 0, covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = ((x + (sx + 0.5) / samples) * 128) / size;
          const v = ((y + (sy + 0.5) / samples) * 128) / size;
          let color;
          for (const [inside, fill] of shapes) if (inside(u, v)) color = fill(u, v);
          if (!color) continue;
          r += color[0]; g += color[1]; b += color[2]; covered += 1;
        }
      }
      const offset = 1 + x * 4;
      if (covered) {
        row[offset] = Math.round(r / covered);
        row[offset + 1] = Math.round(g / covered);
        row[offset + 2] = Math.round(b / covered);
        row[offset + 3] = Math.round((covered / samples ** 2) * 255);
      }
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const output = resolve("public/icons");
await mkdir(output, { recursive: true });
for (const size of sizes) {
  await writeFile(resolve(output, `icon-${size}.png`), makePng(size));
}
