/* Sağlayıcı seçimi: Otomatik = CBOE → Yahoo yedek; Tradier anahtar girilirse */
import { closeMs } from '../usmarket.ts';
import { cboe, clearCboeCache } from './cboe.ts';
import { clearYahooCache, yahoo, yahooQuoteExtras } from './yahoo.ts';
import { tradier } from './tradier.ts';
import { clearMdCache, isStale, marketdata } from './marketdata.ts';
import { mid, type Chain, type OptQuote, type Provider, type ProviderId, type ProvOpts, type Quote } from './types.ts';

export * from './types.ts';
export const PROVIDERS: Record<ProviderId, Provider> = { cboe, yahoo, tradier, marketdata };
export interface Keys { tradier?: string; marketdata?: string }
export const keyFor = (p: ProviderId, k: Keys) => p === 'tradier' ? k.tradier : p === 'marketdata' ? k.marketdata : undefined;
export type ProviderPref = 'auto' | ProviderId;

let mdSkipUntil = 0; // bayat MarketData yanıtından sonra 10 dk kredi harcama
export const resetMdSkip = () => { mdSkipUntil = 0; };
export interface Loaded { provider: ProviderId; quote: Quote; expirations: string[]; note?: string }
/**
 * Sembolü yükle. 'auto' sırası: MarketData (token varsa ve veri taze ise) → Tradier (anahtar varsa) → CBOE → Yahoo.
 * MarketData deneme planı önceki seansı verir; bayatsa atlanır ve not düşülür. CBOE/Tradier'e temettü bilgisi Yahoo'dan eklenir.
 */
export async function loadSymbol(symbol: string, pref: ProviderPref, keys: Keys = {}, signal?: AbortSignal): Promise<Loaded> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, '');
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) throw new Error('Geçersiz sembol');
  const order: ProviderId[] = pref === 'auto'
    ? [...(keys.marketdata ? ['marketdata' as const] : []), ...(keys.tradier ? ['tradier' as const] : []), 'cboe', 'yahoo'] : [pref];
  let lastErr: unknown = null, note: string | undefined;
  for (const id of order) {
    if (pref === 'auto' && id === 'marketdata' && Date.now() < mdSkipUntil) { note = 'MarketData verisi bayat (deneme planı?) — CBOE kullanılıyor'; continue; }
    try {
      const r = await PROVIDERS[id].load(sym, { key: keyFor(id, keys), signal });
      const now = Date.now();
      if (pref === 'auto' && id === 'marketdata' && isStale(r.quote.time, now)) { mdSkipUntil = now + 10 * 60000; note = 'MarketData verisi önceki seansa ait (deneme planı) — CBOE kullanıldı'; continue; }
      const expirations = r.expirations.filter(e => closeMs(e) > now).sort();
      if (id !== 'yahoo' && r.quote.divYield == null) {
        const x = await Promise.race([yahooQuoteExtras(sym), new Promise<null>(res => setTimeout(() => res(null), 6000))]);
        if (x) Object.assign(r.quote, { name: r.quote.name || x.name, divYield: x.divYield, divRate: x.divRate });
      }
      return { provider: id, quote: r.quote, expirations, note };
    } catch (e) {
      if (id === 'marketdata' && pref === 'auto') note = (e as Error)?.message + ' — yedek kaynak kullanıldı';
      if (!lastErr || !/bulunamadı/.test(String((lastErr as Error).message))) lastErr = e; if (signal?.aborted) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Veri alınamadı');
}
export const loadChain = (p: ProviderId, symbol: string, expiry: string, keys: Keys = {}, strikeLimit?: number, extra?: Pick<ProvOpts, 'mdMode' | 'mdMaxAge' | 'signal'>): Promise<Chain> =>
  PROVIDERS[p].chain(symbol, expiry, { ...extra, key: keyFor(p, keys), strikeLimit });

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

export const clearCaches = () => { clearCboeCache(); clearYahooCache(); clearMdCache(); mdSkipUntil = 0; };
