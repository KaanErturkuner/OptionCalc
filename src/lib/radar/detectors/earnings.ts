/* 9. Bilanço yakınlığı (0–5 takvim günü): zımni hareket, son 8 bilançonun gerçekleşen ortalamasının ≥ 1,15× → "pahalı", ≤ 0,85× → "ucuz". */
import type { Baseline, Signal, Snapshot } from '../types.ts';
import { r2, sig } from './util.ts';

export function earnings(s: Snapshot, _b: Baseline): Signal[] {
  if (!s.earnings || s.earnings.days < 0 || s.earnings.days > 5) return [];
  if (s.earningsImpliedPct == null || !s.earningsHistPct || s.earningsHistPct <= 0) return [];
  const ratio = s.earningsImpliedPct / s.earningsHistPct;
  const facts = { gunSonra: s.earnings.days, zimniPct: r2(s.earningsImpliedPct), histPct: r2(s.earningsHistPct), oran: r2(ratio) };
  if (ratio >= 1.15) return [sig(s, 'earnings', 'vol', 0.45, { ...facts, durum: 'pahalı' })];
  if (ratio <= 0.85) return [sig(s, 'earnings', 'vol', 0.35, { ...facts, durum: 'ucuz' })];
  return [];
}
