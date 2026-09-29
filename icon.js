'use strict';
// Иконка приложения по умолчанию: колесо в цветах бренда. Рисуется на лету
// (без картинок и библиотек), поэтому автоматически меняется вместе с цветами.
const zlib = require('node:zlib');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 бит
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

// Все элементы укладываются в центральные 66% — безопасная зона для maskable-иконок.
function colorAt(u, v, bg, fg, hole) {
  const r = Math.hypot(u, v);
  if (r < 0.055) return hole;
  if (r >= 0.5 && r <= 0.66) return fg; // шина
  if (r < 0.15) return fg; // ступица
  if (r > 0.15 && r < 0.52) {
    const th = Math.atan2(v, u);
    for (let k = 0; k < 5; k += 1) {
      const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
      if (r * Math.cos(th - a) > 0 && r * Math.abs(Math.sin(th - a)) < 0.045) return fg;
    }
  }
  return bg;
}

const cache = new Map();

function wheelIcon(size, primary, dark) {
  const key = `${size}${primary}${dark}`;
  if (cache.has(key)) return cache.get(key);
  const bg = hex(dark);
  const fg = hex(primary);
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 3;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let R = 0, G = 0, B = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          const c = colorAt(u, v, bg, fg, bg);
          R += c[0]; G += c[1]; B += c[2];
        }
      }
      const i = (y * size + x) * 3;
      rgb[i] = R / (SS * SS);
      rgb[i + 1] = G / (SS * SS);
      rgb[i + 2] = B / (SS * SS);
    }
  }
  const png = encodePng(size, rgb);
  cache.set(key, png);
  return png;
}

module.exports = { wheelIcon };
