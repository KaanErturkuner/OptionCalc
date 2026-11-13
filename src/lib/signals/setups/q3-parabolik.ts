/* Q3 Parabolik short (put) — DENEYSEL, varsayılan KAPALI. Qullamaggie uyarlaması — Kaan onayı yok. Saf.
 * Uzama: önceki kapanış EMA10'un 3 ATR üstünde (ext ≥ 3) ve ≥ 3 ardışık yükseliş günü.
 * Tetik: bugün ORL kırılımı, ya da ilk 30 dk'da VWAP altına sarkıp geri alamama (bir kapanış VWAP altında + son kapanış VWAP altında).
 * Stop gün zirvesi; hedef giriş − 2 × risk. */
import type { SetupCtx, SetupCandidate } from '../types.ts';
import { dayHigh, inQWindow, orFor, vwapSeries } from './q-common.ts';

export const Q3_EXT_MIN = 3, Q3_UP_DAYS_MIN = 3, Q3_VWAP_WINDOW_BARS = 30;

/** İlk 30 dk'da VWAP'ın altına sarkıp geri alamama: bir kapanış VWAP altında ve son kapanış hâlâ VWAP altında. */
export function failedVwapReclaim(bs: SetupCtx['bars']): boolean {
  if (bs.length < 2 || bs.length > Q3_VWAP_WINDOW_BARS) return false;
  const vw = vwapSeries(bs);
  return bs.some((b, i) => b.c < vw[i]) && bs[bs.length - 1].c < vw[vw.length - 1];
}

export function q3Parabolik(c: SetupCtx): SetupCandidate | null {
  const qd = c.qd;
  if (!qd || !(qd.ext >= Q3_EXT_MIN) || !(qd.upDays >= Q3_UP_DAYS_MIN) || !inQWindow(c.etMin) || c.bars.length < 2) return null;
  const or = orFor(c), last = c.bars[c.bars.length - 1], prev = c.bars[c.bars.length - 2], entry = last.c;
  const orlBreak = !!or && last.c < or.low && prev.c >= or.low;
  const vwapFail = failedVwapReclaim(c.bars);
  if (!orlBreak && !vwapFail) return null;
  const stop = dayHigh(c.bars);
  if (!(stop > entry)) return null;
  return {
    setup: 'Q3', ticker: c.ticker, dir: 'bear', at: c.now, und: { entry, stop, target: entry - 2 * (stop - entry) }, ivMult: 1.0,
    reason: [`Q3: uzama ${qd.ext.toFixed(1)} ATR, ${qd.upDays} ardışık yükseliş`, orlBreak ? 'ORL kırılımı' : 'VWAP geri alınamadı'],
  };
}
