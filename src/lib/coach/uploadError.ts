/* Koç yükleme hatasını Türkçe, kısa ve ayrıştırılabilir bir metne çevirir (saf). Anahtar ya da gövde asla gösterilmez. */
export interface UploadFailure { status?: number; kind?: 'gap' | 'daily'; message: string }

/** status yoksa ağ hatası ya da zaman aşımı (istek sunucuya ulaşmadı ya da yanıt gelmedi) */
export function describeUploadError(e: UploadFailure): string {
  const m = (e.message ?? '').trim();
  const s = e.status;
  if (s === undefined) return /zaman aşımı/i.test(m) ? m : `Ağ hatası: ${m || 'sunucuya ulaşılamadı'}`;
  if (s === 401) return 'Akış anahtarı yanlış (Hesapla › Ayarlar)';
  if (s === 413) return 'Görüntü sunucu sınırını aşıyor (HTTP 413)';
  if (s === 429) return e.kind === 'daily' ? 'Günlük yükleme sınırı doldu (24 saatte en çok 100)' : `Çok hızlı (HTTP 429): ${m}`;
  if (s === 422) return `Dolum çıkarılamadı: ${m}`;
  if (s >= 500) return `Sunucu hatası (HTTP ${s}): ${m}`;
  return `Reddedildi (HTTP ${s}): ${m}`;
}

/** En çok geçen fill tarihi (yoksa boş) — yüklemeden sonra gün seçici oraya geçer */
export function majorityDay(days: string[]): string | null {
  const c = new Map<string, number>();
  for (const d of days) c.set(d, (c.get(d) ?? 0) + 1);
  let best: string | null = null, bn = 0;
  for (const [d, n] of c) if (n > bn || (n === bn && best != null && d > best)) { best = d; bn = n; }
  return best;
}
