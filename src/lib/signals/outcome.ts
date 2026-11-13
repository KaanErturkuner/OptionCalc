/* Sinyal sonucu (kâğıt): dayanak 1 dk barlarla hedef/stop/zaman; MFE/MAE R cinsinden. Saf.
 * Aynı barda hem stop hem hedef: konservatif davranış, önce stop. */
import type { Bar } from '../odte/analytics.ts';
type Dir = 'bull' | 'bear';
export interface OutcomeIn { dir: Dir; entry: number; stop: number; target: number; bars: Bar[]; timeLimitT: number }
export interface Outcome { result: 'hedef' | 'stop' | 'zaman'; exitPx: number; r: number; mfeR: number; maeR: number; exitT: number }

export function evaluateOutcome(i: OutcomeIn): Outcome {
  const s = i.dir === 'bull' ? 1 : -1, risk = Math.abs(i.entry - i.stop);
  const R = (px: number) => risk > 0 ? s * (px - i.entry) / risk : 0;
  let mfe = 0, mae = 0;
  for (const b of i.bars) {
    if (b.t > i.timeLimitT) break;
    const favor = s > 0 ? b.h : b.l, adverse = s > 0 ? b.l : b.h;
    mfe = Math.max(mfe, R(favor)); mae = Math.min(mae, R(adverse));
    const hitStop = s > 0 ? b.l <= i.stop : b.h >= i.stop;
    const hitTarget = s > 0 ? b.h >= i.target : b.l <= i.target;
    if (hitStop) return { result: 'stop', exitPx: i.stop, r: -1, mfeR: mfe, maeR: mae, exitT: b.t };
    if (hitTarget) return { result: 'hedef', exitPx: i.target, r: R(i.target), mfeR: mfe, maeR: mae, exitT: b.t };
  }
  const last = i.bars.filter(b => b.t <= i.timeLimitT).at(-1);
  const px = last ? last.c : i.entry;
  return { result: 'zaman', exitPx: px, r: R(px), mfeR: mfe, maeR: mae, exitT: last?.t ?? i.timeLimitT };
}
