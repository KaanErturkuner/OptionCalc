/* A1/A2 uyumu: profilin rejim ve sektör sembollerinin VWAP / açılış kırılımı yönü (işaret uygulanmış). Saf. */
import type { Bar } from '../odte/analytics.ts';
import { vwapOk, orBreak } from './features.ts';
import type { TickerProfile, Link } from './profiles.ts';

export type Side = 'bull' | 'bear';
export interface AlignOut { vwapAll: boolean; orAll: boolean; sectorAll: boolean; all: boolean }
const opp = (d: Side): Side => d === 'bull' ? 'bear' : 'bull';

/** aux: yardımcı sembollerin seans içi barları (tanımsız = veri yok → uyum yok) */
function linkOk(l: Link, dir: Side, aux: Record<string, Bar[] | undefined>, mode: 'vwap' | 'or'): boolean {
  const bars = aux[l.sym];
  if (!bars || bars.length < 2) return false;
  const d = l.sign > 0 ? dir : opp(dir);
  return mode === 'vwap' ? vwapOk(bars, d) : orBreak(bars, d);
}

export function alignFor(p: TickerProfile, aux: Record<string, Bar[] | undefined>, dir: Side): AlignOut {
  const vwapAll = p.regime.length > 0 && p.regime.every(l => linkOk(l, dir, aux, 'vwap'));
  const orAll = p.regime.length > 0 && p.regime.every(l => linkOk(l, dir, aux, 'or'));
  const sectorAll = p.sector.length === 0 || p.sector.every(l => linkOk(l, dir, aux, 'vwap'));
  return { vwapAll, orAll, sectorAll, all: vwapAll && orAll && sectorAll };
}
