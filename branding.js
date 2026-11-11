import { sb, state } from './state.js';

export function brandURL(kind) {
  const path = state.settings[`${kind}_path`];
  if (path) return sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
  return new URL(`${kind}.svg`, document.baseURI).href;
}

const cache = new Map();
export async function toPng(url, w = 600, h = 600) {
  const key = `${url}|${w}|${h}`;
  if (cache.has(key)) return cache.get(key);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const ratio = Math.min(w / img.naturalWidth, h / img.naturalHeight) || 1;
  const cw = Math.max(1, Math.round(img.naturalWidth * ratio));
  const ch = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
  const out = { data: canvas.toDataURL('image/png'), w: cw, h: ch };
  cache.set(key, out);
  return out;
}
