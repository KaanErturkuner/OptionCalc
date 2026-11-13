/* 0DTE / kısa vade analitiği: OI duvarları, max pain, GEX + gamma flip, P/C oranları, sıra dışı hacim, beklenen hareket, VWAP, ORB, momentum */
import { ncdf } from '../bs.ts';
import { mid, type Chain, type OptQuote } from '../market/types.ts';
import { closeMs, etDate, YEAR_MS } from '../usmarket.ts';

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export function oiWalls(ch: Chain) {
  const top = (l: OptQuote[]) => [...l].filter(o => o.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, 3);
  const c = top(ch.calls), p = top(ch.puts);
  return { callWall: c[0]?.strike ?? null, putWall: p[0]?.strike ?? null, callTop: c.map(o => ({ k: o.strike, oi: o.oi })), putTop: p.map(o => ({ k: o.strike, oi: o.oi })) };
}
/** Max pain: opsiyon alıcılarına toplam ödemenin en düşük olduğu vade fiyatı (strike'lar arasında) */
export function maxPain(ch: Chain): number | null {
  const ks = [...new Set([...ch.calls, ...ch.puts].map(o => o.strike))].sort((a, b) => a - b);
  if (!ks.length) return null;
  let best = ks[0], bestV = Infinity;
  for (const S of ks) {
    let v = 0;
    for (const o of ch.calls) if (S > o.strike) v += (S - o.strike) * o.oi;
    for (const o of ch.puts) if (S < o.strike) v += (o.strike - S) * o.oi;
    if (v < bestV) { bestV = v; best = S; }
  }
  return best;
}
const npdf = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function bsGamma(S: number, K: number, T: number, sig: number, r = 0.04): number {
  if (!(T > 0) || !(sig > 0)) return 0;
  const sT = sig * Math.sqrt(T), d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sT;
  return npdf(d1) / (S * sT);
}
/**
 * Yaklaşık dealer gamma (GEX, $ / %1 hareket): bayilerin call'larda uzun, put'larda kısa gamma taşıdığı klasik varsayım.
 * GEX_k = Γ · OI · 100 · S² · 0,01 (call +, put −). Flip: toplam GEX'in işaret değiştirdiği spot (gamma her spotta yeniden hesaplanır).
 */
export function gex(ch: Chain, S: number, now: number) {
  const T = Math.max(closeMs(ch.expiry) - now, 30 * 60000) / YEAR_MS; // vade günü sonunda Γ patlamasın: min 30 dk
  const ivOf = (o: OptQuote) => o.iv && o.iv > 0.01 ? o.iv : 0.3;
  const total = (spot: number) => {
    let g = 0;
    for (const o of ch.calls) g += bsGamma(spot, o.strike, T, ivOf(o)) * o.oi * 100 * spot * spot * 0.01;
    for (const o of ch.puts) g -= bsGamma(spot, o.strike, T, ivOf(o)) * o.oi * 100 * spot * spot * 0.01;
    return g;
  };
  const byStrike = new Map<number, number>();
  for (const o of ch.calls) byStrike.set(o.strike, (byStrike.get(o.strike) || 0) + bsGamma(S, o.strike, T, ivOf(o)) * o.oi * 100 * S * S * 0.01);
  for (const o of ch.puts) byStrike.set(o.strike, (byStrike.get(o.strike) || 0) - bsGamma(S, o.strike, T, ivOf(o)) * o.oi * 100 * S * S * 0.01);
  const net = total(S);
  // flip: S ±15% ızgarada işaret değişimi, en yakın olan
  let flip: number | null = null, prev = total(S * 0.85), prevS = S * 0.85;
  for (let i = 1; i <= 60; i++) {
    const sp = S * (0.85 + 0.3 * i / 60), v = total(sp);
    if ((prev < 0) !== (v < 0)) {
      const x = prevS + (sp - prevS) * (Math.abs(prev) / (Math.abs(prev) + Math.abs(v)));
      if (flip == null || Math.abs(x - S) < Math.abs(flip - S)) flip = x;
    }
    prev = v; prevS = sp;
  }
  const strikes = [...byStrike.entries()].sort((a, b) => a[0] - b[0]).map(([k, g]) => ({ k, g }));
  return { net, flip, strikes };
}
export function ratios(ch: Chain) {
  const sum = (l: OptQuote[], f: (o: OptQuote) => number) => l.reduce((a, o) => a + f(o), 0);
  const cv = sum(ch.calls, o => o.volume), pv = sum(ch.puts, o => o.volume), co = sum(ch.calls, o => o.oi), po = sum(ch.puts, o => o.oi);
  return { pcVol: cv > 0 ? pv / cv : null, pcOI: co > 0 ? po / co : null, callVol: cv, putVol: pv };
}
/** Sıra dışı: hacim ≥ max(500, 2×OI) */
export function unusual(ch: Chain, minVol = 500) {
  return [...ch.calls, ...ch.puts].filter(o => o.volume >= minVol && o.volume >= 2 * Math.max(o.oi, 1))
    .sort((a, b) => b.volume - a.volume).slice(0, 5).map(o => ({ type: o.type, k: o.strike, vol: o.volume, oi: o.oi }));
}
/** ATM straddle (mid) → beklenen hareket */
export function expectedMove(ch: Chain, S: number) {
  const ks = ch.calls.map(o => o.strike); if (!ks.length) return null;
  const k = ks.reduce((a, b) => Math.abs(b - S) < Math.abs(a - S) ? b : a);
  const c = ch.calls.find(o => o.strike === k), p = ch.puts.find(o => o.strike === k);
  if (!c || !p) return null;
  const v = mid(c) + mid(p); return v > 0 ? { strike: k, move: v, pct: v / S } : null;
}

/** Sadece bugünkü normal seans barları (09:30–16:00 ET) */
export function sessionBars(bars: Bar[], now: number): Bar[] {
  if (!bars.length) return [];
  const day = etDate(bars[bars.length - 1].t), open = closeMs(day) - 6.5 * 3600000, close = closeMs(day);
  return bars.filter(b => b.t >= open && b.t < close && b.c > 0 && b.t <= now);
}
export function vwap(bars: Bar[]): number | null {
  let pv = 0, v = 0;
  for (const b of bars) { const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; v += b.v; }
  return v > 0 ? pv / v : null;
}
export function openingRange(bars: Bar[], minutes: number) {
  if (!bars.length) return null;
  const t0 = closeMs(etDate(bars[0].t)) - 6.5 * 3600000, end = t0 + minutes * 60000;
  const or = bars.filter(b => b.t < end);
  if (!or.length || bars[bars.length - 1].t < end - 60000) return { complete: false, high: NaN, low: NaN };
  return { complete: true, high: Math.max(...or.map(b => b.h)), low: Math.min(...or.map(b => b.l)) };
}
export function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1), out: number[] = []; let e = xs[0];
  xs.forEach((x, i) => { e = i ? x * k + e * (1 - k) : x; out.push(e); });
  return out;
}
export function momentum(bars: Bar[]) {
  const c = bars.map(b => b.c); if (c.length < 22) return null;
  const e9 = ema(c, 9), e21 = ema(c, 21), n = c.length - 1;
  return { ema9: e9[n], ema21: e21[n], r5: c[n] / c[n - 5] - 1, r15: c.length > 15 ? c[n] / c[n - 15] - 1 : 0 };
}
/** Basit lognormal olasılık: S_T > K (T yıl) */
export const probAbove = (S: number, K: number, T: number, sig: number) => T > 0 && sig > 0 ? ncdf((Math.log(S / K) - sig * sig / 2 * T) / (sig * Math.sqrt(T))) : (S > K ? 1 : 0);
