/* 5. Skew kayması: 25Δ risk reversal taban ortalamasından ≥ 2σ yukarıysa (put'lar pahalanıyor) → bear. */
import type { Baseline, Signal, Snapshot } from '../types.ts';
import { clamp, confidence, guard, r2, sig } from './util.ts';

export function skewShift(s: Snapshot, b: Baseline): Signal[] {
  if (s.rr25 == null || !guard(b, 20) || b.rr25Mean == null || !b.rr25Std || b.rr25Std <= 0) return [];
  const z = (s.rr25 - b.rr25Mean) / b.rr25Std;
  if (z < 2) return [];
  const c = confidence(b, clamp(0.5 + (z - 2) * 0.1, 0.5, 0.85));
  return [sig(s, 'skew', 'bear', c.sev, { rr25: r2(s.rr25 * 100), tabanRr25: r2(b.rr25Mean * 100), z: r2(z), guven: c.guven })];
}
