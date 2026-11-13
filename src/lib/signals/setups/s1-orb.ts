/* S1 Uyumlu açılış aralığı kırılımı (orb-uyum). Kaan'ın ana tarzı. */
import type { SetupCtx, SetupCandidate, Dir } from '../types.ts';
import { MIN_STOP_EM } from './shared.ts';

export function orbUyum(c: SetupCtx): SetupCandidate | null {
  if (c.etMin < 585 || c.bars.length < 2 || c.vwap == null) return null;
  const last = c.bars.at(-1)!, prev = c.bars.at(-2)!, height = c.orHi - c.orLo;
  if (height > 0.6 * c.em || c.volRatio < 2) return null;
  for (const dir of ['bull', 'bear'] as Dir[]) {
    if (!c.align[dir]) continue;
    const up = dir === 'bull';
    const brk = up ? last.c > c.orHi && prev.c <= c.orHi : last.c < c.orLo && prev.c >= c.orLo;
    const side = up ? last.c > c.vwap! : last.c < c.vwap!;
    if (!brk || !side) continue;
    const entry = last.c, mid = (c.orHi + c.orLo) / 2, barEdge = up ? last.l : last.h;
    // Stop: OR orta noktası ile kırılım barı ucundan girişe yakın olan; en az 0,15 EM uzakta
    let stop = up ? Math.max(mid, barEdge) : Math.min(mid, barEdge);
    stop = up ? Math.min(stop, entry - MIN_STOP_EM * c.em) : Math.max(stop, entry + MIN_STOP_EM * c.em);
    // Hedef: giriş ± max(2 × OR), en fazla açılış ± 1,2 EM
    const open = c.bars[0].o;
    const raw = up ? entry + 2 * height : entry - 2 * height;
    const cap = up ? open + 1.2 * c.em : open - 1.2 * c.em;
    const target = up ? Math.min(raw, cap) : Math.max(raw, cap);
    if (up ? target <= entry : target >= entry) continue;
    return { setup: 'S1', ticker: c.ticker, dir, at: c.now, und: { entry, stop, target }, ivMult: 1.0,
      reason: [`OR ${up ? 'yukarı' : 'aşağı'} kırıldı`, `hacim ${c.volRatio.toFixed(1)}×`, `VWAP ${up ? 'üstünde' : 'altında'}`] };
  }
  return null;
}
