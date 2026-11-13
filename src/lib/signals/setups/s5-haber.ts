/* S5 Haber sonrası devam (haber-devam). Haber tetik; bilanço/makro vetosu bu setup için uygulanmaz. IV çarpanı 0,8. */
import type { SetupCtx, SetupCandidate, Dir } from '../types.ts';
import { hiOf, loOf } from './shared.ts';

export function haberDevam(c: SetupCtx): SetupCandidate | null {
  const n = c.newsImpulse;
  if (!n) return null;
  const idx = c.bars.findIndex(b => b.t >= n.t);
  if (idx < 0 || c.bars.length - idx < 7) return null;
  const up = n.dir === 'bull', base = c.bars[idx].o, after = c.bars.slice(idx);
  const impulse = up ? hiOf(after) - base : base - loOf(after);
  if (impulse < 0.5 * c.em) return null;
  const cons = c.bars.slice(-6, -1), last = c.bars.at(-1)!, entry = last.c;
  const retained = up ? entry >= base + 0.5 * impulse : entry <= base - 0.5 * impulse;
  const brk = up ? entry > hiOf(cons) : entry < loOf(cons);
  if (!retained || !brk || !c.align[n.dir as Dir]) return null;
  const stop = up ? loOf(cons) : hiOf(cons);
  if (up ? stop >= entry : stop <= entry) return null;
  const target = up ? entry + impulse : entry - impulse;
  return { setup: 'S5', ticker: c.ticker, dir: n.dir, at: c.now, und: { entry, stop, target }, ivMult: 0.8,
    reason: [`haber sonrası sıçrama ${impulse.toFixed(2)} (≥ ½ EM)`, '≥5 dk konsolidasyon, sıçramanın ≥ %50’si korundu', 'konsolidasyon kırıldı'] };
}
