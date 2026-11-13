/* Bir sembol için veri topla (fiyat + en yakın vade zinciri + 1 dk barlar) ve sinyal motorunu çalıştır */
import { loadChain, loadSymbol, type Keys } from '../market/index.ts';
import { loadBars } from '../market/bars.ts';
import type { Chain, ProviderId } from '../market/types.ts';
import { closeMs, etDate } from '../usmarket.ts';
import { analyze, DEFAULT_OPTS, type EngineOpts, type Result } from './signal.ts';
import type { Bar } from './analytics.ts';

export interface ScanItem {
  ticker: string; ok: boolean; error?: string; result?: Result; price?: number; changePct?: number;
  expiry?: string; dte?: number; source?: string; barsSource?: string; delayedMin?: number; credits: number; time: number; bars?: Bar[]; note?: string;
}
/** Dayanak etrafında ±%pct strike'ları tut (büyük CBOE zincirlerinde hız için) */
export function trimChain(ch: Chain, S: number, pct = 0.15): Chain {
  const f = (k: number) => Math.abs(k / S - 1) <= pct;
  return { ...ch, calls: ch.calls.filter(o => f(o.strike)), puts: ch.puts.filter(o => f(o.strike)) };
}
export async function scanOne(ticker: string, keys: Keys, opts: EngineOpts = DEFAULT_OPTS, strikeLimit = 40, signal?: AbortSignal): Promise<ScanItem> {
  const t0 = Date.now();
  try {
    const L = await loadSymbol(ticker, 'auto', keys, signal);
    const now = Date.now(), today = etDate(now);
    const exp = L.expirations.find(e => e >= today && closeMs(e) > now) ?? L.expirations[0];
    if (!exp) return { ticker, ok: false, error: 'Listelenmiş opsiyon yok', credits: L.quote.credits ?? 0, time: t0 };
    const src: ProviderId = L.provider;
    const [chRaw, B] = await Promise.all([loadChain(src, ticker, exp, keys, strikeLimit), loadBars(ticker, src === 'marketdata' ? keys.marketdata : undefined, signal)]);
    const S = L.quote.price, ch = trimChain(chRaw, S);
    const result = analyze(ticker, S, ch, B.bars, now, opts);
    const dte = Math.max(0, Math.round((Date.parse(exp) - Date.parse(today)) / 86400000));
    return { ticker, ok: true, result, price: S, changePct: L.quote.changePct, expiry: exp, dte, source: L.quote.source, barsSource: B.source,
      delayedMin: L.quote.delayedMin, credits: (L.quote.credits ?? 0) + (chRaw.credits ?? 0) + B.credits, time: now, bars: B.bars, note: L.note };
  } catch (e) {
    return { ticker, ok: false, error: (e as Error)?.message || 'Hata', credits: 0, time: t0 };
  }
}
/** Tahmini kredi / yenileme (MarketData): sembol başına quote 1 + vade listesi 1 + zincir ≈ 2×strikeLimit + mum 1 */
export const creditsPerRefresh = (n: number, strikeLimit: number) => n * (3 + 2 * strikeLimit);
