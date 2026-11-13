/* 6. Rehavet / panik. Rehavet: IV rank ≤ 15 ve P/C ≤ 0,7× taban ve realize oynaklık > IV → vol ("koruma ucuz").
 *    Panik: IV rank ≥ 85 ve P/C ≥ 1,5× taban → vol ("korku zirvesi"). Endeks, sektör ETF'i ve tek hisse için aynı kurallar. */
import type { Baseline, Signal, Snapshot } from '../types.ts';
import { confidence, guard, r2, sig } from './util.ts';
import { ivRankOf } from '../baseline.ts';

export function complacency(s: Snapshot, b: Baseline): Signal[] {
  if (!guard(b, 20) || b.pcVol20 == null || b.pcVol20 <= 0 || s.pcVol == null || s.atmIv == null) return [];
  const { rank } = ivRankOf(s.atmIv, b.ivHist);
  if (rank == null) return [];
  const pcRatio = s.pcVol / b.pcVol20;
  const facts = { ivRank: Math.round(rank), pcOran: r2(pcRatio), ivPct: r2(s.atmIv * 100) };
  if (rank <= 15 && pcRatio <= 0.7 && b.rv20 != null && b.rv20 > s.atmIv) {
    const c = confidence(b, 0.5);
    return [sig(s, 'complacency', 'vol', c.sev, { ...facts, rv20Pct: r2(b.rv20 * 100), guven: c.guven })];
  }
  if (rank >= 85 && pcRatio >= 1.5) {
    const c = confidence(b, 0.6);
    return [sig(s, 'panic', 'vol', c.sev, { ...facts, guven: c.guven })];
  }
  return [];
}
