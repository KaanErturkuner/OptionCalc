/* 7. Gamma / pin (yalnızca 0DTE): fiyat OI duvarına / max pain'e beklenen hareketin ±%30'u içindeyse pin riski (neutral).
 *    Fiyat gamma flip'in altındaysa oynaklık artabilir (vol). */
import type { Signal, Snapshot } from '../types.ts';
import { clamp, r2, sig } from './util.ts';

export function pin(s: Snapshot): Signal[] {
  if (s.dte !== 0 || s.expectedMove == null || s.expectedMove <= 0) return [];
  const out: Signal[] = [];
  const levels: [string, number | null][] = [['callDuvarı', s.callWall], ['putDuvarı', s.putWall], ['maxPain', s.maxPain]];
  for (const [name, L] of levels) {
    if (L == null) continue;
    const d = s.spot - L;
    if (Math.abs(d) <= 0.3 * s.expectedMove) out.push(sig(s, 'pin', 'neutral', 0.4, { seviye: r2(L), seviyeAd: name, uzaklik: r2(d), beklenenHareket: r2(s.expectedMove) }));
  }
  if (s.flip != null && s.spot < s.flip) out.push(sig(s, 'gamma', 'vol', clamp(0.5 + 0.1 * (s.flip - s.spot) / s.expectedMove, 0.5, 0.8), { flip: r2(s.flip), spot: r2(s.spot) }));
  return out;
}
