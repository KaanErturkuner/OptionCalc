/* S6 Ucuz IV + hareket öncesi (ucuz-iv). Yalnız 1–3 DTE. IV çarpanı 1,05. */
import type { SetupCtx, SetupCandidate, Dir } from '../types.ts';
import { box, squeezed } from './shared.ts';

export function ucuzIv(c: SetupCtx): SetupCandidate | null {
  if (c.dte < 1 || c.dte > 3) return null;
  if (c.ivRank == null || c.ivRank >= 20 || c.rv10 == null || c.atmIv == null || !(c.rv10 > c.atmIv)) return null;
  if (!squeezed(c.bars, c.em)) return null;
  const last = c.bars.at(-1)!, b = box(c.bars, 20), open = c.bars[0].o;
  for (const dir of ['bull', 'bear'] as Dir[]) {
    if (!c.align[dir]) continue;
    const up = dir === 'bull';
    if (!(up ? last.c > b.hi : last.c < b.lo)) continue;
    const entry = last.c;
    return { setup: 'S6', ticker: c.ticker, dir, at: c.now, und: { entry, stop: b.mid, target: up ? open + c.em : open - c.em }, ivMult: 1.05,
      reason: [`IV rank ${c.ivRank.toFixed(0)} < 20`, `RV10 ${(c.rv10 * 100).toFixed(0)}% > ATM IV ${(c.atmIv * 100).toFixed(0)}%`, 'sıkışma kırıldı'] };
  }
  return null;
}
