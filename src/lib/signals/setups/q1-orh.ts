/* Q1 ORH kırılımı (call) ve Q1S ORL kırılımı (put, zayıf isimde ayna). Qullamaggie uyarlaması — Kaan onayı yok. Saf.
 * Q1: trend yukarı, SPY'den güçlü (rs63 > 0), daralma (son 5 gün / önceki 20 gün ≤ 0,8), yakın tepe; ORH kırılımı + hacim ≥ 1,5×.
 * Q1S: ayna (trend aşağı, rs63 < 0, yakın dip, ORL kırılımı, stop gün zirvesi). */
import type { SetupCtx, SetupCandidate } from '../types.ts';
import { QD } from '../qull/daily.ts';
import { breakoutCandidate, rsOk } from './q-common.ts';

export function q1Orh(c: SetupCtx): SetupCandidate | null {
  const qd = c.qd;
  if (!qd || !qd.trendUp || !rsOk(qd, 'bull')) return null;
  if (!(qd.consol.rangeContraction <= QD.CONTRACTION_MAX) || !qd.consol.nearHigh) return null;
  return breakoutCandidate(c, 'Q1', 'bull', ['Q1: trend yukarı', 'daralma', 'yakın tepe']);
}

export function q1sOrl(c: SetupCtx): SetupCandidate | null {
  const qd = c.qd;
  if (!qd || !qd.trendDown || !rsOk(qd, 'bear')) return null;
  if (!(qd.consol.rangeContraction <= QD.CONTRACTION_MAX) || !qd.consol.nearLow) return null;
  return breakoutCandidate(c, 'Q1S', 'bear', ['Q1S: trend aşağı', 'daralma', 'yakın dip']);
}
