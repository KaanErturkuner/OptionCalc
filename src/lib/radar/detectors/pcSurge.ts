/* 1. Put/Call yığılması: P/C hacmi ≥ 2× taban VE toplam hacim ≥ 1,5× → bear (tersi: P/C ≤ 0,5× → bull) */
import type { Baseline, Signal, Snapshot } from '../types.ts';
import { clamp, confidence, guard, r2, sig } from './util.ts';

export function pcSurge(s: Snapshot, b: Baseline): Signal[] {
  if (!guard(b, 5) || s.pcVol == null || b.pcVol20 == null || b.pcVol20 <= 0 || s.totalVol == null || !b.totalVol20) return [];
  const pcRatio = s.pcVol / b.pcVol20, volRatio = s.totalVol / b.totalVol20;
  if (volRatio < 1.5) return [];
  const facts = { pc: r2(s.pcVol), tabanPc: r2(b.pcVol20), pcOran: r2(pcRatio), hacim: Math.round(s.totalVol), hacimOran: r2(volRatio) };
  if (pcRatio >= 2) { const c = confidence(b, clamp(0.4 + 0.15 * (pcRatio - 2), 0.4, 0.9)); return [sig(s, 'pcSurge', 'bear', c.sev, { ...facts, guven: c.guven })]; }
  if (pcRatio <= 0.5) { const c = confidence(b, clamp(0.4 + 0.15 * (0.5 / pcRatio - 1), 0.4, 0.9)); return [sig(s, 'pcSurge', 'bull', c.sev, { ...facts, guven: c.guven })]; }
  return [];
}
