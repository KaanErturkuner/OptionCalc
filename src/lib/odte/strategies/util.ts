/* Stratejiler için küçük yardımcılar: bar istatistikleri, VWAP serisi, kontrat seçimi */
import { mid, spreadPct, type Chain, type OptQuote } from '../../market/types.ts';
import type { Bar } from '../analytics.ts';
import type { Dir } from './types.ts';

export function vwapAt(bars: Bar[], n = bars.length): number | null {
  let pv = 0, v = 0;
  for (let i = 0; i < n && i < bars.length; i++) { const b = bars[i]; pv += (b.h + b.l + b.c) / 3 * b.v; v += b.v; }
  return v > 0 ? pv / v : null;
}
export const avgVol = (bars: Bar[], from: number, to: number) => {
  let s = 0, k = 0; for (let i = Math.max(0, from); i < Math.min(to, bars.length); i++) { s += bars[i].v; k++; } return k ? s / k : 0;
};
export const hi = (bars: Bar[], from = 0, to = bars.length) => { let x = -Infinity; for (let i = Math.max(0, from); i < Math.min(to, bars.length); i++) x = Math.max(x, bars[i].h); return x; };
export const lo = (bars: Bar[], from = 0, to = bars.length) => { let x = Infinity; for (let i = Math.max(0, from); i < Math.min(to, bars.length); i++) x = Math.min(x, bars[i].l); return x; };
/** Son n barın getirisi */
export const ret = (bars: Bar[], n: number) => bars.length > n ? bars[bars.length - 1].c / bars[bars.length - 1 - n].c - 1 : 0;
/** Açılış aralığı (ilk `minutes` dk) — yalnızca tamamlandıysa */
export function openRange(bars: Bar[], minutes: number): { high: number; low: number } | null {
  if (bars.length < minutes) return null;
  return { high: hi(bars, 0, minutes), low: lo(bars, 0, minutes) };
}
export interface PickOpts { targetDelta: number; maxSpread: number; minVol: number; minOI: number }
/** Likit (spread/hacim/OI) ve deltası hedefe en yakın kontrat */
export function pickContract(ch: Chain, dir: Dir, S: number, o: PickOpts): OptQuote | null {
  const list = dir === 'call' ? ch.calls : ch.puts, sg = dir === 'call' ? 1 : -1;
  const ok = list.filter(q => q.bid > 0 && q.ask > 0 && spreadPct(q) <= o.maxSpread && (q.volume >= o.minVol || q.oi >= o.minOI) && mid(q) > 0.05);
  if (!ok.length) return null;
  const dOf = (q: OptQuote) => q.delta != null && q.delta !== 0 ? Math.abs(q.delta) : Math.max(0.05, Math.min(0.95, 0.5 - sg * (q.strike - S) / (S * 0.02) * 0.15));
  return ok.reduce((a, b) => Math.abs(dOf(b) - o.targetDelta) < Math.abs(dOf(a) - o.targetDelta) ? b : a);
}
export const clampStop = (S: number, stop: number, dir: Dir, minD: number, maxD: number) => {
  const sg = dir === 'call' ? 1 : -1; let d = sg * (S - stop);
  if (!(d > 0)) d = minD; d = Math.min(Math.max(d, minD), maxD);
  return S - sg * d;
};
/** Hedef strike'a en yakın likit kontrat (OTM seçimi için) */
export function pickStrike(ch: Chain, dir: Dir, strike: number, o: Omit<PickOpts, 'targetDelta'>, S?: number): OptQuote | null {
  const list = dir === 'call' ? ch.calls : ch.puts;
  // S verilirse yalnız OTM taraf (call K ≥ S, put K ≤ S): hedef strike likit değilse ITM'e kaymasın
  const ok = list.filter(q => (S == null || (dir === 'call' ? q.strike >= S : q.strike <= S)) && q.bid > 0 && q.ask > 0 && spreadPct(q) <= o.maxSpread && (q.volume >= o.minVol || q.oi >= o.minOI) && mid(q) > 0.05);
  return ok.length ? ok.reduce((a, b) => Math.abs(b.strike - strike) < Math.abs(a.strike - strike) ? b : a) : null;
}
