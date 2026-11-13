/* Günlük taban çizgisi: 20 gün P/C ve hacim ortalamaları, 1 yıl ATM IV, realize oynaklık, 25Δ RR ort./std. */
import type { Baseline, DayRecord } from './types.ts';

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const std = (xs: number[]) => { if (xs.length < 2) return null; const m = mean(xs)!; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && isFinite(x));
/** Yıllık realize oynaklık: son n log-getirinin std'si × √252 */
export function realizedVol(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  const c = closes.slice(-(n + 1)), r: number[] = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) r.push(Math.log(c[i] / c[i - 1]));
  const s = std(r); return s == null ? null : s * Math.sqrt(252);
}
/** Gün kayıtlarından taban çizgisi. days: tarih artan sıralı, bugünkü kayıt HARİÇ (look-ahead yok). */
export function buildBaseline(days: DayRecord[]): Baseline {
  const sorted = [...days].sort((a, b) => a.date < b.date ? -1 : 1);
  const last20 = sorted.slice(-20), last252 = sorted.slice(-252);
  const closes = nums(sorted.map(d => d.close));
  const rr = nums(last20.map(d => d.rr25));
  return {
    n: nums(last252.map(d => d.atmIv)).length,
    n20: nums(last20.map(d => d.pcVol)).length,
    pcVol20: mean(nums(last20.map(d => d.pcVol))),
    totalVol20: mean(nums(last20.map(d => d.totalVol))),
    avgContractVol20: mean(nums(last20.map(d => d.avgContractVol))),
    ivHist: nums(last252.map(d => d.atmIv)),
    rv10: realizedVol(closes, 10), rv20: realizedVol(closes, 20),
    rr25Mean: mean(rr), rr25Std: std(rr),
  };
}
/** IV rank (1 yıl min–max, 0..100) ve percentile (geçmişin yüzde kaçı daha düşük, 0..100). hist boşsa null. */
export function ivRankOf(cur: number | null, hist: number[]): { rank: number | null; pctile: number | null } {
  if (cur == null || !isFinite(cur) || hist.length < 20) return { rank: null, pctile: null };
  const lo = Math.min(...hist), hi = Math.max(...hist);
  const rank = hi > lo ? Math.min(100, Math.max(0, (cur - lo) / (hi - lo) * 100)) : 50;
  const pctile = hist.filter(x => x < cur).length / hist.length * 100;
  return { rank, pctile };
}
