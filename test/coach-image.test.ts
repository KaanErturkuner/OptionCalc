// Koç görüntü yardımcıları (saf): boyut ölçekleme, sihirli bayt biçimi, yükleme hatası metni. Ağ YOK.
import { scaleDims, sniffMime, checkImage, b64Head } from '../src/lib/coach/image.ts';
import { describeUploadError, majorityDay } from '../src/lib/coach/uploadError.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
// Saf base64 kodlayıcı (test; Buffer yok — tsconfig'te node tipleri yok)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64 = (bytes: number[]) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = [(n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63].map(v => B64[v]);
    const rem = bytes.length - i;
    out += chars.slice(0, rem >= 3 ? 4 : rem + 1).join('') + (rem < 3 ? '='.repeat(3 - rem) : '');
  }
  return out;
};
const pad = (head: number[], n = 64) => [...head, ...Array(Math.max(0, n - head.length)).fill(0)];

// --- scaleDims: tall iPhone screenshot → 1600 genişlik ve 2000 uzun kenar sınırı; büyütme yok
const tall = scaleDims(1290, 2796)!;
ok('ölçek: 1290x2796 → uzun kenar 2000', tall.height === 2000 && tall.width === 923, JSON.stringify(tall));
ok('ölçek: en-boy oranı korunur (±1 px)', Math.abs(tall.width / tall.height - 1290 / 2796) < 0.002);
const wide = scaleDims(4032, 3024)!;
ok('ölçek: 4032x3024 → 1600x1200', wide.width === 1600 && wide.height === 1200, JSON.stringify(wide));
const small = scaleDims(800, 600)!;
ok('ölçek: küçük görüntü büyütülmez', small.width === 800 && small.height === 600 && small.scale === 1);
ok('ölçek: geçersiz boyut → null', scaleDims(0, 100) === null && scaleDims(NaN, 100) === null);

// --- sniffMime
ok('biçim: JPEG', sniffMime(b64(pad([0xff, 0xd8, 0xff, 0xe0]))) === 'image/jpeg');
ok('biçim: PNG', sniffMime(b64(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))) === 'image/png');
ok('biçim: GIF', sniffMime(b64(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) === 'image/gif');
// HEIC: 4 bayt boyut + "ftyp" + marka "heic"
ok('biçim: HEIC', sniffMime(b64(pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))) === 'image/heic');
ok('biçim: ftyp avif → bilinmiyor', sniffMime(b64(pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))) === 'unknown');
ok('biçim: boş/kısa → bilinmiyor', sniffMime('') === 'unknown' && sniffMime(b64([0xff])) === 'unknown');
ok('b64Head: 12 bayt okunur (eski 6 bayt sınırı kalktı)', b64Head(b64(pad([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), 12).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12');
// checkImage davranışı değişmedi (sunucuyla aynı kural)
ok('checkImage: JPEG kabul', checkImage('image/jpeg', b64(pad([0xff, 0xd8, 0xff]))).ok === true);
ok('checkImage: PNG olarak etiketlenmiş JPEG reddedilir', checkImage('image/png', b64(pad([0xff, 0xd8, 0xff]))).ok === false);

// --- describeUploadError
ok('hata: ağ', describeUploadError({ message: 'Sunucuya ulaşılamadı (ağ)' }) === 'Ağ hatası: Sunucuya ulaşılamadı (ağ)');
ok('hata: zaman aşımı', describeUploadError({ message: 'Zaman aşımı — tekrar dene' }) === 'Zaman aşımı — tekrar dene');
ok('hata: 401', describeUploadError({ status: 401, message: 'x' }).startsWith('Akış anahtarı yanlış'));
ok('hata: 413', describeUploadError({ status: 413, message: 'x' }).includes('413'));
ok('hata: 429 günlük', describeUploadError({ status: 429, kind: 'daily', message: 'x' }).startsWith('Günlük yükleme sınırı'));
ok('hata: 429 hız', describeUploadError({ status: 429, kind: 'gap', message: 'Çok hızlı — 2 sn sonra dene' }).includes('Çok hızlı'));
ok('hata: 422 dolum', describeUploadError({ status: 422, message: 'tutar yok' }) === 'Dolum çıkarılamadı: tutar yok');
ok('hata: 502 sunucu', describeUploadError({ status: 502, message: 'Anthropic 500 (api_error)' }) === 'Sunucu hatası (HTTP 502): Anthropic 500 (api_error)');
ok('hata: 400 reddedildi', describeUploadError({ status: 400, message: 'Görüntü base64 değil' }) === 'Reddedildi (HTTP 400): Görüntü base64 değil');

// --- majorityDay: yüklenen dolumların en çok geçen tarihi
ok('gün: en çok geçen', majorityDay(['2026-11-13', '2026-11-13', '2026-11-12']) === '2026-11-13');
ok('gün: boş → null', majorityDay([]) === null);
ok('gün: eşitlikte en yeni', majorityDay(['2026-11-12', '2026-11-13']) === '2026-11-13');

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm koç görüntü testleri geçti');
process.exit(fail ? 1 : 0);
