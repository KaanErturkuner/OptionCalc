/* Bir sembol için veri topla (fiyat + en yakın vade zinciri + 1 dk barlar) ve sinyal motorunu çalıştır */
import { loadChain, loadSymbol, type Keys } from '../market/index.ts';
import { loadBars } from '../market/bars.ts';
import type { Chain, ProviderId } from '../market/types.ts';
import { closeMs, etDate } from '../usmarket.ts';
import { decide, DEFAULT_OPTS, features, type EngineOpts, type Result, type Features } from './signal.ts';
import type { Bar } from './analytics.ts';
import { autoK, type OtmRule } from '../signals/otm.ts';
import { buildVerdict, type VerdictCard, type VerdictInputs, type QuoteLite } from '../signals/verdict.ts';
import { regimeSummary } from '../market/regime.ts';

/** 0DTE uzaklık kuralı (oynaklığa göre k; geçmiş yetersizse başlangıç değeri). Kaan'ın kuralı: k × beklenen hareket. */
export const ODTE_OTM_RULE: OtmRule = { mode: 'oto', k0: 0.5, kMin: 0.3, kMax: 0.9 };
/** Sonuç kartı girdileri (göstergelerden) */
export function verdictInputsOf(F: Features, S: number): VerdictInputs {
  const mo = F.mo;
  return {
    S, vwap: F.vw, orHigh: F.orng?.complete ? F.orng.high : null, orLow: F.orng?.complete ? F.orng.low : null,
    flip: F.gx.flip, callWall: F.w.callWall, putWall: F.w.putWall, emMove: F.em?.move ?? null, pcVol: F.ra.pcVol,
    unusualCall: F.unus.filter(u => u.type === 'call').reduce((a, u) => a + u.vol, 0),
    unusualPut: F.unus.filter(u => u.type === 'put').reduce((a, u) => a + u.vol, 0),
    momentum: mo ? (mo.ema9 > mo.ema21 && mo.r5 > 0 ? 1 : mo.ema9 < mo.ema21 && mo.r5 < 0 ? -1 : 0) : null,
  };
}

export interface ScanItem {
  ticker: string; ok: boolean; error?: string; result?: Result; price?: number; changePct?: number;
  expiry?: string; dte?: number; source?: string; barsSource?: string; delayedMin?: number; credits: number; time: number; bars?: Bar[]; note?: string;
  verdict?: VerdictCard;
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
    const F = features(S, ch, B.bars, now, opts.orMinutes);
    const result = decide(ticker, S, ch, F, now, opts);
    const dte = Math.max(0, Math.round((Date.parse(exp) - Date.parse(today)) / 86400000));
    const em = F.em?.move ?? null, kk = autoK({ rule: ODTE_OTM_RULE, ratios: [], ivRank: null }).k;
    const quotes: QuoteLite[] = [...ch.calls, ...ch.puts].map(q => ({ type: q.type, strike: q.strike, bid: q.bid, ask: q.ask, volume: q.volume, oi: q.oi }));
    const verdict = buildVerdict({ inputs: { ...verdictInputsOf(F, S), regime: regimeSummary(B.bars, now) }, expiries: [{ date: exp, dte }], nowMs: now,
      quotesFor: e => e === exp ? quotes : null, dOf: () => (em != null ? kk * em : null) });
    return { ticker, ok: true, result, price: S, changePct: L.quote.changePct, expiry: exp, dte, source: L.quote.source, barsSource: B.source,
      delayedMin: L.quote.delayedMin, credits: (L.quote.credits ?? 0) + (chRaw.credits ?? 0) + B.credits, time: now, bars: B.bars, note: L.note, verdict };
  } catch (e) {
    return { ticker, ok: false, error: (e as Error)?.message || 'Hata', credits: 0, time: t0 };
  }
}
/** Tahmini kredi / yenileme (MarketData): sembol başına quote 1 + vade listesi 1 + zincir ≈ 2×strikeLimit + mum 1 */
export const creditsPerRefresh = (n: number, strikeLimit: number) => n * (3 + 2 * strikeLimit);
