/* Q setupları ortak yardımcılar: pencere, açılış aralığı seçimi, ilk kırılım, gün dibi/zirvesi, VWAP serisi, kırılım adayı.
 * Saf. Qullamaggie uyarlaması — Kaan onayı yok. Giriş penceresi 09:30–13:00 ET (Kaan: 16:30–20:00 İstanbul). */
import type { Bar } from '../../odte/analytics.ts';
import type { SetupCtx, SetupCandidate, SetupId, Dir, OrRange, QParams } from '../types.ts';
import { Q_DEFAULT_PARAMS } from '../qull/policy.ts';
import type { QDaily } from '../qull/daily.ts';

/** ET dakika (gece yarısından): 09:30 = 570, 13:00 = 780 */
export const Q_WINDOW_START = 570, Q_WINDOW_END = 780;
export const inQWindow = (etMin: number) => etMin >= Q_WINDOW_START && etMin <= Q_WINDOW_END;
export const qParams = (c: SetupCtx): QParams => c.qp ?? Q_DEFAULT_PARAMS;

/** Seçilen açılış aralığı (orMin 5|30). Yoksa null. */
export function orFor(c: SetupCtx): OrRange | null {
  const w = c.orWin;
  if (!w) return null;
  return (qParams(c).orMin === 30 ? w.m30 : w.m5) ?? null;
}

export const dayLow = (bs: Bar[]) => bs.reduce((m, b) => Math.min(m, b.l), Infinity);
export const dayHigh = (bs: Bar[]) => bs.reduce((m, b) => Math.max(m, b.h), -Infinity);

/** Göreli güç koşulu: SPY serisi yoksa RS bileşeni atlanır (true); varsa hisse SPY'den güçlü (yükseliş) / zayıf (düşüş) olmalı. */
export function rsOk(qd: QDaily, dir: Dir): boolean {
  if (!qd.spy) return true;
  return qd.rs63 != null && (dir === 'bull' ? qd.rs63 > 0 : qd.rs63 < 0);
}

/** Son bar, açılış aralığını İLK kez yukarı (yükseliş) ya da aşağı (düşüş) keser. */
export function firstCross(bs: Bar[], or: OrRange, dir: Dir): boolean {
  if (bs.length < 2) return false;
  const last = bs[bs.length - 1], prev = bs[bs.length - 2];
  return dir === 'bull' ? last.c > or.high && prev.c <= or.high : last.c < or.low && prev.c >= or.low;
}

/** Bar başına kümülatif VWAP (tipik fiyat × hacim). */
export function vwapSeries(bs: Bar[]): number[] {
  let pv = 0, v = 0;
  return bs.map(b => { pv += (b.h + b.l + b.c) / 3 * b.v; v += b.v; return v > 0 ? pv / v : b.c; });
}

/** Kırılım adayı: giriş = son kapanış; stop = gün dibi (yükseliş) / gün zirvesi (düşüş); hedef = giriş ± 2 × risk (yalnız RR/strike için).
 * Koşullar: pencere, açılış aralığı verisi, ilk kırılım, hacim ≥ volMult, stop giriş tarafında. */
export function breakoutCandidate(c: SetupCtx, setup: SetupId, dir: Dir, reason: string[]): SetupCandidate | null {
  const or = orFor(c), qp = qParams(c);
  if (!c.qd || !or || !inQWindow(c.etMin) || c.bars.length < qp.orMin + 1) return null;
  if (!firstCross(c.bars, or, dir)) return null;
  if (!(c.volRatio >= qp.volMult)) return null;
  const entry = c.bars[c.bars.length - 1].c, up = dir === 'bull';
  const stop = up ? dayLow(c.bars) : dayHigh(c.bars);
  if (up ? !(stop < entry) : !(stop > entry)) return null;
  const target = up ? entry + 2 * (entry - stop) : entry - 2 * (stop - entry);
  return {
    setup, ticker: c.ticker, dir, at: c.now, und: { entry, stop, target }, ivMult: 1.0,
    reason: [...reason, `${qp.orMin} dk açılış ${up ? 'yükseği' : 'dibi'} kırıldı`, `hacim ${c.volRatio.toFixed(1)}×`],
  };
}
