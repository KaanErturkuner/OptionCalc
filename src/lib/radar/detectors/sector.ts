/* 8. Sektör ayrışması: hisse ile sektör ETF'i TERS yönde ve fark ≥ 1,5 × beklenen hareket (%) → neutral bilgi. */
import type { Signal, Snapshot } from '../types.ts';
import { clamp, r2, sig } from './util.ts';

export function sectorDivergence(s: Snapshot): Signal[] {
  if (!s.sector || s.emPct == null || s.emPct <= 0) return [];
  const diff = s.changePct - s.sector.changePct, emPctPts = s.emPct * 100;
  if (s.changePct * s.sector.changePct >= 0 || Math.abs(diff) < 1.5 * emPctPts) return [];
  return [sig(s, 'sector', 'neutral', clamp(0.35 + 0.05 * Math.abs(diff) / emPctPts, 0.35, 0.6), {
    hisseDegisimPct: r2(s.changePct), sektor: s.sector.ticker, sektorDegisimPct: r2(s.sector.changePct), fark: r2(diff), beklenenPct: r2(emPctPts),
  })];
}
