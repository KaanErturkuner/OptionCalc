/*
 * Haber başlıklarını Türkçeye çevirme. Anahtarsız çeviri uç noktası (Google gtx); sonuçlar bellekte önbelleklenir.
 * Çeviri başarısız olursa orijinal metin döner (haber asla kaybolmaz). Ağ çağrısı: translateTr; saf kısım: parseGtx.
 * NOT: gtx resmi bir API değildir; kullanım koşulu ve hız sınırı değişebilir. Güvenilir üretim için resmi bir çeviri anahtarı önerilir.
 */

/** gtx yanıtı: [[[çeviri, orijinal, ...], ...], null, "en"] → çevrilmiş metin ve algılanan dil */
export function parseGtx(json: unknown): { text: string; lang: string } | null {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null;
  const text = (json[0] as unknown[]).map(seg => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
  const lang = typeof json[2] === 'string' ? json[2] : '';
  return text ? { text, lang } : null;
}

const cache = new Map<string, string>();
export const translateCacheSize = () => cache.size;

/** Tek metni Türkçeye çevirir. Kaynak zaten Türkçeyse olduğu gibi döner. */
export async function translateTr(text: string, signal?: AbortSignal): Promise<string> {
  const key = text.trim();
  if (!key) return text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(key)}`;
    const r = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`çeviri HTTP ${r.status}`);
    const p = parseGtx(await r.json());
    const out = p && p.lang !== 'tr' ? p.text : key;
    cache.set(key, out);
    return out;
  } catch {
    return key;   // hata: orijinal (önbelleğe alınmaz, sonraki denemede yeniden çevrilir)
  }
}

/** Birçok başlığı sınırlı eşzamanlılıkla çevirir (varsayılan 4). Sonuç: orijinal → çeviri. */
export async function translateMany(texts: string[], concurrency = 4, signal?: AbortSignal): Promise<Map<string, string>> {
  const uniq = [...new Set(texts.map(t => t.trim()).filter(Boolean))];
  const out = new Map<string, string>();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, uniq.length) }, async () => {
    while (i < uniq.length) { const t = uniq[i++]; out.set(t, await translateTr(t, signal)); }
  }));
  return out;
}
