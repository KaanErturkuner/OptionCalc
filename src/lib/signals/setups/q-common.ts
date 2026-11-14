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

/** Kırılım taze sayılan en fazla dakika (tarama aralığı ≤ 5 dk). */
export const Q_BREAK_LOOKBACK = 5;
/**
 * Kırılım indeksi: gün içindeki İLK kapanış (açılış aralığı dışında) bu bar mı ve son kapanış hâlâ dışarıda mı?
 * İlk kırılım barı son Q_BREAK_LOOKBACK dakika içindeyse indeksini döndürür; değilse null.
 * Izgara değerlendirmesi (5 dk) kırılım barını kaçırmaz ve aynı kırılım iki kez aday olmaz.
 */
export function breakIndex(bs: Bar[], or: OrRange, dir: Dir): number | null {
  const n = bs.length;
  if (n < 2) return null;
  const beyond = (b: Bar) => dir === 'bull' ? b.c > or.high : b.c < or.low;
  if (!beyond(bs[n - 1])) return null;
  const f = bs.findIndex(beyond);
  return f >= 0 && f >= n - 1 - Q_BREAK_LOOKBACK ? f : null;
}
/** Kırılım barının hacim oranı: o barın hacmi / önceki en çok 20 barın ortalaması (NaN: referans yok). */
export function breakVolRatio(bs: Bar[], f: number): number {
  const prev = bs.slice(Math.max(0, f - 20), f);
  const avg = prev.length ? prev.reduce((s, b) => s + b.v, 0) / prev.length : 0;
  return avg > 0 ? bs[f].v / avg : NaN;
}

/** Bar başına kümülatif VWAP (tipik fiyat × hacim). */
export function vwapSeries(bs: Bar[]): number[] {
  let pv = 0, v = 0;
  return bs.map(b => { pv += (b.h + b.l + b.c) / 3 * b.v; v += b.v; return v > 0 ? pv / v : b.c; });
}

/** Kırılım adayı: giriş = son kapanış; stop = gün dibi (yükseliş) / gün zirvesi (düşüş); hedef = giriş ± 2 × risk (yalnız RR/strike için).
 * Koşullar: pencere, açılış aralığı verisi, taze ilk kırılım (breakIndex), kırılım barında hacim ≥ volMult, stop giriş tarafında. */
export function breakoutCandidate(c: SetupCtx, setup: SetupId, dir: Dir, reason: string[]): SetupCandidate | null {
  const or = orFor(c), qp = qParams(c);
  if (!c.qd || !or || !inQWindow(c.etMin) || c.bars.length < qp.orMin + 1) return null;
  const f = breakIndex(c.bars, or, dir);
  if (f == null) return null;
  const vr = breakVolRatio(c.bars, f);
  if (!(vr >= qp.volMult)) return null;
  const entry = c.bars[c.bars.length - 1].c, up = dir === 'bull';
  const stop = up ? dayLow(c.bars) : dayHigh(c.bars);
  if (up ? !(stop < entry) : !(stop > entry)) return null;
  const target = up ? entry + 2 * (entry - stop) : entry - 2 * (stop - entry);
  return {
    setup, ticker: c.ticker, dir, at: c.now, und: { entry, stop, target }, ivMult: 1.0,
    reason: [...reason, `${qp.orMin} dk açılış ${up ? 'yükseği' : 'dibi'} kırıldı`, `hacim ${vr.toFixed(1)}×`],
  };
}
