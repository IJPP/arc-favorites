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

// "Pinned app": a white app tile with a dark pin in its corner, on the
// accent squircle. Drawn on a 128-unit grid; small sizes use a bolder
// variant without the pin's centre dot so it stays crisp at 16 px.
const ACCENT = [59, 108, 246];
const INK = [28, 31, 39];
const WHITE = [255, 255, 255];

function roundedRect(x, y, width, height, radius) {
  return (u, v) => {
    if (u < x || u > x + width || v < y || v > y + height) return false;
    const cx = Math.min(Math.max(u, x + radius), x + width - radius);
    const cy = Math.min(Math.max(v, y + radius), y + height - radius);
    return (u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2;
  };
}

function disk(cx, cy, radius) {
  return (u, v) => (u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2;
}

function layers(size) {
  const small = size <= 32;
  const tile = small ? roundedRect(28, 42, 58, 58, 16) : roundedRect(30, 40, 56, 56, 16);
  const pin = small
    ? [[disk(88, 38, 24), ACCENT], [disk(88, 38, 16), INK]]
    : [[disk(88, 38, 20.5), ACCENT], [disk(88, 38, 13.5), INK], [disk(88, 38, 5.5), WHITE]];
  return [[roundedRect(8, 8, 112, 112, 30), ACCENT], [tile, WHITE], ...pin];
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
          for (const [inside, fill] of shapes) if (inside(u, v)) color = fill;
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
