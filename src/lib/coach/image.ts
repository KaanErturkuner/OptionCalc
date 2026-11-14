/* Görüntü girişi denetimi (saf): tür (PNG/JPEG), boyut (çözülmüş ≤ 4 MiB), base64 biçimi, sihirli bayt. */

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_MIMES = ['image/png', 'image/jpeg'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** İlk n bayt (base64 çözümü; yalnız sihirli bayt için, saf JS: Buffer yok) */
export function b64Head(b64: string, n: number): number[] {
  const bits: number[] = [];
  for (const ch of b64.slice(0, Math.ceil(n / 3) * 4)) { const v = B64.indexOf(ch); if (v < 0) break; for (let k = 5; k >= 0; k--) bits.push((v >> k) & 1); }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length && out.length < n; i += 8) { let x = 0; for (let k = 0; k < 8; k++) x = (x << 1) | bits[i + k]; out.push(x); }
  return out;
}

export function checkImage(mime: unknown, b64: unknown): { ok: true; mime: ImageMime; bytes: number } | { ok: false; error: string } {
  if (mime !== 'image/png' && mime !== 'image/jpeg') return { ok: false, error: 'Yalnız PNG veya JPEG kabul edilir' };
  if (typeof b64 !== 'string' || !b64.length) return { ok: false, error: 'Görüntü verisi yok' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, error: 'Görüntü base64 değil' };
  const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: 'Görüntü 4 MB sınırını aşıyor' };
  const head = b64Head(b64, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png' ? !isPng : !isJpg) return { ok: false, error: 'Dosya içeriği bildirilen türle uyuşmuyor' };
  return { ok: true, mime, bytes };
}

export type SniffedMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/heic' | 'unknown';

/** Sihirli baytlardan biçim (saf). HEIC/WebP/GIF bilgi amaçlıdır: sunucu yalnız PNG/JPEG kabul eder. */
export function sniffMime(b64: string): SniffedMime {
  const h = b64Head(b64, 12);
  if (h.length < 4) return 'unknown';
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png';
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) return 'image/gif';
  if (h.length >= 12 && h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return 'image/webp';
  if (h.length >= 12 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) {
    const brand = String.fromCharCode(h[8], h[9], h[10], h[11]);
    if (/^(heic|heix|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  return 'unknown';
}

/** Yükleme öncesi boyut: en çok maxWidth genişlik ve maxLong uzun kenar; büyütme yok, en-boy oranı korunur (saf). */
export function scaleDims(w: number, h: number, maxWidth = 1600, maxLong = 2000): { width: number; height: number; scale: number } | null {
  if (!(w > 0) || !(h > 0)) return null;
  const scale = Math.min(1, maxWidth / w, maxLong / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}
