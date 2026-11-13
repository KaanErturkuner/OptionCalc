/* Strike tarayıcı (§6.1): ATM ile uzaklık kuralı (d = k × EM) arasındaki OTM strikeları tarar. Delta 0,15–0,50, likidite filtresi. Saf. */
import type { OptType } from '../american.ts';
import { greeks } from '../bs.ts';
import { optionRR, type RRResult } from './rr.ts';

export interface Quote { type: OptType; strike: number; bid: number; ask: number; iv: number | null; volume: number; oi: number }
export interface StrikeInput {
  type: OptType; S: number; d: number;                       // d = k × EM_vade ($)
  quotes: Quote[]; T0: number; und: { entry: number; stop: number; target: number };
  emRemain: number; sessionLeftMin: number;
  minVol?: number; minOi?: number; maxSpreadPct?: number; minDelta?: number; maxDelta?: number; r?: number;
}
export interface StrikePick {
  strike: number; delta: number; rr: RRResult;
  dRule: { strike: number; rr: RRResult | null };       // uzaklık kuralı strike'ı ve onun RR'ı
  skipped: string[];
}

export function scanStrikes(i: StrikeInput): StrikePick | null {
  const minVol = i.minVol ?? 50, minOi = i.minOi ?? 100, maxSp = i.maxSpreadPct ?? 8, dMin = i.minDelta ?? 0.15, dMax = i.maxDelta ?? 0.5;
  const skipped: string[] = [], cands: StrikePick[] = [];
  const otm = (K: number) => i.type === 'call' ? K > i.S : K < i.S;
  const rrFor = (q: Quote) => optionRR({ type: i.type, S: i.S, K: q.strike, T0: i.T0, sigma: q.iv ?? 0, bid: q.bid, ask: q.ask, und: i.und,
    emRemain: i.emRemain, sessionLeftMin: i.sessionLeftMin });
  for (const q of i.quotes) {
    if (q.type !== i.type || !otm(q.strike) || Math.abs(q.strike - i.S) > i.d) continue;
    if (!(q.bid > 0) || !(q.ask > 0)) { skipped.push(`${q.strike}: likit değil`); continue; }
    if ((q.ask - q.bid) / q.ask * 100 > maxSp) { skipped.push(`${q.strike}: spread geniş`); continue; }
    if (q.volume < minVol && q.oi < minOi) { skipped.push(`${q.strike}: hacim/OI yetersiz`); continue; }
    if (q.iv == null || !(q.iv > 0)) { skipped.push(`${q.strike}: IV yok`); continue; }
    const delta = Math.abs(greeks(i.type, i.S, q.strike, i.T0, i.r ?? 0.04, 0, q.iv).delta);
    if (delta < dMin || delta > dMax) { skipped.push(`${q.strike}: delta ${delta.toFixed(2)} aralık dışında`); continue; }
    cands.push({ strike: q.strike, delta, rr: rrFor(q), dRule: { strike: 0, rr: null }, skipped: [] });
  }
  if (!cands.length) return null;
  // Önce skor (burada likidite ve delta uygunluğu sırası), sonra RR; RR geçerli olmalı
  const best = cands.filter(c => c.rr.valid).sort((a, b) => b.rr.rr - a.rr.rr)[0];
  if (!best) return null;
  // Uzaklık kuralı strike'ı: S ± d'ye en yakın grid strike
  const target = i.type === 'call' ? i.S + i.d : i.S - i.d;
  const dq = i.quotes.filter(q => q.type === i.type && otm(q.strike) && q.iv != null)
    .sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target))[0];
  const dRule = dq ? { strike: dq.strike, rr: rrFor(dq) } : { strike: target, rr: null };
  return { ...best, dRule, skipped };
}
