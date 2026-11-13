/* Canlıya geçiş / aday eşikleri — docs/PLAN.md ile aynı tutun. */
import type { XMet } from './engine.mts';
export const CRITERIA = {
  candidate: { minN: 60, minExpPct: 0.03, minPF: 1.15, minCiLo: -0.02 },       // walk-forward OOS'ta "aday" (kâğıt işleme geçer)
  live: { minN: 100, minExpPct: 0.05, minPF: 1.25, minCiLo: 0, maxMddR: 10 },    // kâğıt işlem + OOS birlikte; mdd ≤ 10 × ortalama kayıp
};
export function verdict(m: XMet): 'ADAY' | 'ZAYIF' | 'RED' | 'YETERSİZ VERİ' {
  const c = CRITERIA.candidate;
  if (m.n < 20) return 'YETERSİZ VERİ';
  if (m.n >= c.minN && m.expPct >= c.minExpPct && m.pf >= c.minPF && m.ci95[0] >= c.minCiLo) return 'ADAY';
  if (m.expPct > 0) return 'ZAYIF';
  return 'RED';
}
