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

function insideRoundedRect(x, y, size, radius) {
  const edge = size - 1;
  const cx = x < radius ? radius : x > edge - radius ? edge - radius : x;
  const cy = y < radius ? radius : y > edge - radius ? edge - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function makePng(size) {
  const rows = [];
  const radius = size * 0.24;
  const background = [36, 38, 48, 255];
  const bars = [
    { x: 0.25, width: 0.13, top: 0.49, color: [185, 188, 255, 255] },
    { x: 0.435, width: 0.13, top: 0.25, color: [244, 244, 255, 255] },
    { x: 0.62, width: 0.13, top: 0.38, color: [143, 149, 255, 255] },
  ];

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      let color = insideRoundedRect(x, y, size, radius) ? background : [0, 0, 0, 0];
      for (const bar of bars) {
        const left = size * bar.x;
        const right = left + size * bar.width;
        const top = size * bar.top;
        const bottom = size * 0.76;
        if (x >= left && x <= right && y >= top && y <= bottom) color = bar.color;
      }
      const offset = 1 + x * 4;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = color[3];
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
