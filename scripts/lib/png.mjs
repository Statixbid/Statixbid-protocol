import { inflateSync } from "node:zlib";

// Minimal 8-bit, non-interlaced PNG reader (colour types 2 and 6) for the premultiplied-resize gate.
export function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let pos = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (bd !== 8 || il !== 0 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported png ct=${ct} bd=${bd} il=${il}`);
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ct, bpp, data: out };
}
