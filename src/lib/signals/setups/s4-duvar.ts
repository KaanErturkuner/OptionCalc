/* S4 Gamma / OI duvarı kırılımı (duvar-kirilim). */
import type { SetupCtx, SetupCandidate } from '../types.ts';

export function duvarKirilim(c: SetupCtx): SetupCandidate | null {
  const w = c.walls;
  if (!w || !w.gexNeg || c.bars.length < 2 || c.volRatio < 2) return null;
  const last = c.bars.at(-1)!, prev = c.bars.at(-2)!, entry = last.c;
  if (w.call != null && prev.c <= w.call && last.c > w.call && c.align.bull) {
    const stop = w.call - 0.1 * c.em, risk = entry - stop;
    return { setup: 'S4', ticker: c.ticker, dir: 'bull', at: c.now, und: { entry, stop, target: Math.max(entry + 0.7 * c.emRemain, entry + 4 * risk) }, ivMult: 1.0,
      reason: [`call duvarı ${w.call} yukarı geçildi`, 'net GEX negatif', `hacim ${c.volRatio.toFixed(1)}×`] };
  }
  if (w.put != null && prev.c >= w.put && last.c < w.put && c.align.bear) {
    const stop = w.put + 0.1 * c.em, risk = stop - entry;
    return { setup: 'S4', ticker: c.ticker, dir: 'bear', at: c.now, und: { entry, stop, target: Math.min(entry - 0.7 * c.emRemain, entry - 4 * risk) }, ivMult: 1.0,
      reason: [`put duvarı ${w.put} aşağı geçildi`, 'net GEX negatif', `hacim ${c.volRatio.toFixed(1)}×`] };
  }
  return null;
}
