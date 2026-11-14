/*
 * Bilanço takvimi istemcisi (fetch; ağ). Sunucu (Finnhub önbelleği): GET /earnings, GET /earnings/history, POST /earnings/favs.
 * Anahtar yalnız x-app-key başlığında gider, loglanmaz. Hata metinleri kısa ve Türkçedir.
 */
import { FLOW_BASE_URL } from '../flow/model.ts';
import { APP_KEY_HEADER } from '../flow/proxy.ts';
import type { EarnHistory, EarningsRange } from './model.ts';

export type { EarningsItem, EarningsRange, EarnHour, EarnHistory, EarnHistoryRow } from './model.ts';

export class EarningsHttpError extends Error {
  status?: number;
}

const base = (b?: string) => (b ?? FLOW_BASE_URL).replace(/\/+$/, '');

/** Ortak istek: anahtar başlıkta; hata metinleri Türkçe; 401 ayrı mesaj. */
async function call<T>(url: string, init: { method?: string; body?: string } = {}, key: string): Promise<T> {
  if (!key) throw new EarningsHttpError('Akış anahtarı girilmedi (Hesapla › Ayarlar)');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const headers: Record<string, string> = { [APP_KEY_HEADER]: key, Accept: 'application/json' };
    if (init.body != null) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method: init.method ?? 'GET', headers, body: init.body, signal: ctl.signal });
    const text = await r.text();
    let j: any = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* yapısal olmayan yanıt */ }
    if (r.status === 401) throw Object.assign(new EarningsHttpError('Akış anahtarı yanlış (Hesapla › Ayarlar)'), { status: 401 });
    if (!r.ok) throw Object.assign(new EarningsHttpError(typeof j?.error === 'string' ? j.error : `Sunucu hatası (HTTP ${r.status})`), { status: r.status });
    return j as T;
  } catch (e: any) {
    if (e instanceof EarningsHttpError) throw e;
    if (e?.name === 'AbortError') throw new EarningsHttpError('Zaman aşımı — tekrar dene');
    if (e instanceof TypeError) throw new EarningsHttpError('Sunucuya ulaşılamadı');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Takvim aralığı (en çok 31 gün). watch: izleme listesi + favori semboller (piyasa değeri filtresini geçer). */
export function fetchEarnings(key: string, from: string, to: string, watch: string[] = [], b?: string): Promise<EarningsRange> {
  const w = watch.length ? `&watch=${encodeURIComponent(watch.join(','))}` : '';
  return call<EarningsRange>(`${base(b)}/earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${w}`, {}, key);
}

/** Geçmiş bilanço çeyrekleri (sembol). */
export const fetchEarningsHistory = (key: string, symbol: string, b?: string): Promise<EarnHistory> =>
  call<EarnHistory>(`${base(b)}/earnings/history?symbol=${encodeURIComponent(symbol)}`, {}, key);

/** Cihaz favorileri → sunucu (tam değiştirme). token: Expo push tokenı (bildirim için). */
export const syncEarnFavs = (key: string, token: string, symbols: string[], b?: string): Promise<{ ok: boolean; count: number }> =>
  call(`${base(b)}/earnings/favs`, { method: 'POST', body: JSON.stringify({ token, symbols }) }, key);
