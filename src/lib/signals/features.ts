/* Bar tabanlı özellikler: VWAP tarafı, çoklu zaman dilimi EMA uyumu, 15 dk açılış aralığı kırılımı, hacim oranı. Saf. */
import { vwap, ema, type Bar } from '../odte/analytics.ts';
type Dir = 'bull' | 'bear';

export function resample(bars: Bar[], minutes: number): Bar[] {
  const out: Bar[] = [], step = minutes * 60000;
  for (const b of bars) {
    const k = Math.floor(b.t / step) * step, last = out[out.length - 1];
    if (last && last.t === k) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v; }
    else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  return out;
}

/** Son kapanış VWAP'ın üstünde mi (bull uyumu) */
export function vwapOk(bars: Bar[], dir: Dir): boolean {
  const vw = vwap(bars), last = bars.at(-1)?.c;
  if (vw == null || last == null) return false;
  return dir === 'bull' ? last > vw : last < vw;
}

/** Bir zaman diliminde EMA9/EMA21 yönü ve VWAP tarafı uyumlu mu (en az 21 çubuk gerekir) */
export function frameAligned(bars: Bar[], dir: Dir, minutes: number): boolean {
  const r = resample(bars, minutes);
  if (r.length < 21) return false;
  const closes = r.map(b => b.c), e9 = ema(closes, 9).at(-1)!, e21 = ema(closes, 21).at(-1)!;
  return vwapOk(bars, dir) && (dir === 'bull' ? e9 > e21 : e9 < e21);
}

/** İlk 15 dakikanın (barların ilk t0'dan itibaren) kırılımı */
export function orBreak(bars: Bar[], dir: Dir, minutes = 15): boolean {
  if (!bars.length) return false;
  const end = bars[0].t + minutes * 60000, or = bars.filter(b => b.t < end);
  if (!or.length || bars.length <= or.length) return false;
  const hi = Math.max(...or.map(b => b.h)), lo = Math.min(...or.map(b => b.l)), last = bars.at(-1)!.c;
  return dir === 'bull' ? last > hi : last < lo;
}

/** Son barın hacmi / önceki 20 barın ortalaması (yetersizse NaN) */
export function volRatio(bars: Bar[]): number {
  if (bars.length < 21) return NaN;
  const prev = bars.slice(-21, -1), avg = prev.reduce((a, b) => a + b.v, 0) / 20;
  return avg > 0 ? bars.at(-1)!.v / avg : NaN;
}
