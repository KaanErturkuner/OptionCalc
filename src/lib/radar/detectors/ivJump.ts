/* 4. IV sıçraması (≥ +%15, seans başına göre) → vol. IV çöküşü (≤ −%15) ancak bilançodan 0–2 gün sonra → bilgi amaçlı (düşük şiddet). */
import type { Signal, Snapshot } from '../types.ts';
import { clamp, r2, sig } from './util.ts';

export function ivJump(s: Snapshot): Signal[] {
  if (s.atmIv == null || !s.atmIvSession0 || s.atmIvSession0 <= 0) return [];
  const ch = s.atmIv / s.atmIvSession0 - 1;
  const facts = { ivPct: r2(s.atmIv * 100), seansBasiPct: r2(s.atmIvSession0 * 100), degisimPct: r2(ch * 100) };
  if (ch >= 0.15) return [sig(s, 'ivJump', 'vol', clamp(0.5 + (ch - 0.15), 0.5, 0.85), facts)];
  const justAfterEarnings = s.earnings != null && s.earnings.days <= 0 && s.earnings.days >= -2;
  if (ch <= -0.15 && justAfterEarnings) return [sig(s, 'ivJump', 'vol', 0.2, { ...facts, not: 'bilanço sonrası IV çöküşü (bilgi)' })];
  return [];
}
