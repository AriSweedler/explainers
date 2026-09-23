// og:image: the 1200 x 630 PNG that iMessage, Slack and the rest show for a
// pasted link. `validate` warns when the head names assets/og.png and the file
// is missing or the wrong shape; `build` cannot fix it (the card needs a
// browser), tools/og-image.mjs does.
import fs from 'node:fs';
import path from 'node:path';
import { byTag, attr, line } from './html.mjs';

export const OG_IMAGE = 'assets/og.png';
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// { width, height } from the signature + IHDR (the first 24 bytes), or null
// when the bytes are not a PNG.
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

export function checkOgImage(doc, file, problems) {
  const meta = byTag(doc, 'meta').find((m) => attr(m, 'property') === 'og:image');
  if (!meta) return;
  const content = attr(meta, 'content') || '';
  if (content !== OG_IMAGE && !content.endsWith(`/${OG_IMAGE}`)) return;
  const abs = path.resolve(path.dirname(file), OG_IMAGE);
  const fix = `run: node tools/og-image.mjs ${file}`;
  if (!fs.existsSync(abs)) { problems.warn(file, line(meta), null, `og:image ${OG_IMAGE} not found; ${fix}`); return; }
  const size = pngSize(readHead(abs, 24));
  if (!size) problems.warn(file, line(meta), null, `og:image ${OG_IMAGE} is not a PNG; ${fix}`);
  else if (size.width !== OG_WIDTH || size.height !== OG_HEIGHT) problems.warn(file, line(meta), null, `og:image ${OG_IMAGE} is ${size.width}x${size.height}, not ${OG_WIDTH}x${OG_HEIGHT}; ${fix}`);
}
