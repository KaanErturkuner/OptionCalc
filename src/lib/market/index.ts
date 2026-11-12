/* Sağlayıcı seçimi: Otomatik = CBOE → Yahoo yedek; Tradier anahtar girilirse */
import { closeMs } from '../usmarket.ts';
import { cboe, clearCboeCache } from './cboe.ts';
import { clearYahooCache, yahoo, yahooQuoteExtras } from './yahoo.ts';
import { tradier } from './tradier.ts';
import { mid, type Chain, type OptQuote, type Provider, type ProviderId, type Quote } from './types.ts';

export * from './types.ts';
export const PROVIDERS: Record<ProviderId, Provider> = { cboe, yahoo, tradier };
export type ProviderPref = 'auto' | ProviderId;

export interface Loaded { provider: ProviderId; quote: Quote; expirations: string[] }
/** Sembolü yükle; 'auto' sırası: CBOE → Yahoo. CBOE kullanılırsa temettü bilgisi Yahoo'dan (sessizce) eklenir. */
export async function loadSymbol(symbol: string, pref: ProviderPref, key?: string, signal?: AbortSignal): Promise<Loaded> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, '');
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) throw new Error('Geçersiz sembol');
  const order: ProviderId[] = pref === 'auto' ? (key ? ['tradier', 'cboe', 'yahoo'] : ['cboe', 'yahoo']) : [pref];
  let lastErr: unknown = null;
  for (const id of order) {
    try {
      const r = await PROVIDERS[id].load(sym, { key, signal });
      const now = Date.now();
      const expirations = r.expirations.filter(e => closeMs(e) > now).sort();
      if (id !== 'yahoo' && r.quote.divYield == null) {
        const x = await Promise.race([yahooQuoteExtras(sym), new Promise<null>(res => setTimeout(() => res(null), 6000))]);
        if (x) Object.assign(r.quote, { name: r.quote.name || x.name, divYield: x.divYield, divRate: x.divRate });
      }
      return { provider: id, quote: r.quote, expirations };
    } catch (e) { if (!lastErr || !/bulunamadı/.test(String((lastErr as Error).message))) lastErr = e; if (signal?.aborted) throw e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Veri alınamadı');
}
export const loadChain = (p: ProviderId, symbol: string, expiry: string, key?: string): Promise<Chain> => PROVIDERS[p].chain(symbol, expiry, { key });

export { marketOpen } from '../usmarket.ts';
/** Seçilen strike'a en yakın kontrat */
export function nearest(list: OptQuote[], strike: number): OptQuote | null {
  let b: OptQuote | null = null;
  for (const o of list) if (!b || Math.abs(o.strike - strike) < Math.abs(b.strike - strike)) b = o;
  return b;
}
/** Spot çevresindeki n strike (picker için) */
export function around(list: OptQuote[], center: number, n = 6): OptQuote[] {
  if (!list.length) return [];
  let i = 0; list.forEach((o, j) => { if (Math.abs(o.strike - center) < Math.abs(list[i].strike - center)) i = j; });
  return list.slice(Math.max(0, i - n), Math.min(list.length, i + n + 1));
}
/** Tercih edilen fiyat: mid (bid/ask varsa), yoksa son işlem */
export const premiumOf = (o: OptQuote) => +mid(o).toFixed(2);
/** Gerçek vadelerden hedefe en yakını */
export function closestExpiry(list: string[], target: string): string | null {
  if (!list.length) return null;
  const t = Date.parse(target);
  return list.reduce((a, b) => Math.abs(Date.parse(b) - t) < Math.abs(Date.parse(a) - t) ? b : a);
}

export const clearCaches = () => { clearCboeCache(); clearYahooCache(); };
