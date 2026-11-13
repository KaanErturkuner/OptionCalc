/* S3 Trend içi VWAP geri alma (vwap-geri-alma). */
import type { SetupCtx, SetupCandidate, Dir } from '../types.ts';
import { hiOf, loOf } from './shared.ts';

export function vwapGeriAlma(c: SetupCtx): SetupCandidate | null {
  if (c.bars.length < 61 || c.vwap == null) return null;
  const last = c.bars.at(-1)!, trend = c.bars.slice(-61, -16), pull = c.bars.slice(-16, -1), prev = c.bars.slice(-36, -16);
  const vw = c.vwap;
  for (const dir of ['bull', 'bear'] as Dir[]) {
    if (!c.align[dir]) continue;
    const up = dir === 'bull';
    // Trend: son 60 dk'nın ≥ %90'ı VWAP'ın doğru tarafında
    const onSide = trend.filter(b => up ? b.c > vw : b.c < vw).length / trend.length;
    if (onSide < 0.9) continue;
    // Geri çekilme: VWAP'a veya 0,1 EM içine değdi; hacim düşük (ort. < önceki ort.)
    const touched = up ? loOf(pull) <= vw + 0.1 * c.em : hiOf(pull) >= vw - 0.1 * c.em;
    const meanPull = pull.reduce((a, b) => a + b.v, 0) / pull.length, meanPrev = prev.reduce((a, b) => a + b.v, 0) / prev.length;
    if (!touched || !(meanPrev > 0 && meanPull / meanPrev < 1)) continue;
    // Dönüş: hacimli (≥1,5), trend yönünde mum, VWAP'ın doğru tarafında kapanış
    const bullBar = up ? last.c > last.o && last.c > vw : last.c < last.o && last.c < vw;
    if (!bullBar || c.volRatio < 1.5) continue;
    const entry = last.c;
    const stop = up ? Math.min(loOf(pull), entry - 0.1 * c.em) : Math.max(hiOf(pull), entry + 0.1 * c.em);
    const target = up ? hiOf(c.bars) + 0.5 * c.emRemain : loOf(c.bars) - 0.5 * c.emRemain;
    if (up ? target <= entry : target >= entry) continue;
    return { setup: 'S3', ticker: c.ticker, dir, at: c.now, und: { entry, stop, target }, ivMult: 1.0,
      reason: ['trend VWAP’ın doğru tarafında', 'VWAP’a geri çekilme, düşük hacim', `dönüş mumu hacim ${c.volRatio.toFixed(1)}×`] };
  }
  return null;
}
