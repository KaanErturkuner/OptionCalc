/* S2 Sıkışma sonrası kırılım (sikisma). */
import type { SetupCtx, SetupCandidate, Dir } from '../types.ts';
import { box, squeezed, MIN_STOP_EM } from './shared.ts';

export function sikisma(c: SetupCtx): SetupCandidate | null {
  if (!squeezed(c.bars, c.em) || c.volRatio < 2) return null;
  const last = c.bars.at(-1)!, b = box(c.bars, 20);
  for (const dir of ['bull', 'bear'] as Dir[]) {
    if (!c.align[dir]) continue;
    const up = dir === 'bull';
    const brk = up ? last.c > b.hi : last.c < b.lo;
    if (!brk) continue;
    const entry = last.c;
    const stop = up ? Math.min(b.mid, entry - MIN_STOP_EM * c.em) : Math.max(b.mid, entry + MIN_STOP_EM * c.em);
    const d = Math.max(3 * b.h, 0.5 * c.emRemain);
    const target = up ? entry + d : entry - d;
    return { setup: 'S2', ticker: c.ticker, dir, at: c.now, und: { entry, stop, target }, ivMult: 1.0,
      reason: [`20 dk sıkışma (kutu ${b.h.toFixed(2)} ≤ ¼ EM)`, `kutu ${up ? 'yukarı' : 'aşağı'} kırıldı`, `hacim ${c.volRatio.toFixed(1)}×`] };
  }
  return null;
}
