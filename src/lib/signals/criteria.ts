/* Fırsat geçiş kriterleri ("Güvenilir ✓" için) — SINYAL-FIRSAT §9.4. Saf. Backtest (OOS) ve kâğıt testi ayrı kapılardır. */

export const FIRSAT_CRITERIA = {
  minN: 60,                 // OOS işlem sayısı (setup × ticker)
  minExpR: 0.15,            // beklenti, R cinsinden
  minPF: 1.3,
  minCiLo: 0,               // bootstrap %95 GA alt sınırı > 0
  spreadMult: 1.5,          // spread ×1,5'te beklenti hâlâ > 0
  paperMinN: 30,            // kâğıt testi: kova bazında en az 30 sinyal
  paperWinGapMax: 10,       // gerçekleşen kazanma, OOS'un en fazla 10 puan altında
} as const;

export interface OosStats {
  n: number; expR: number; pf: number; ciLo: number; expRSpread15: number;
}
export interface PaperStats {
  n: number; winPct: number; expR: number;
}

export type BacktestVerdict = 'GEÇTİ' | 'KALDI' | 'YETERSİZ VERİ';

/** Backtest kapısı (OOS). Her koşul ayrı raporlanabilir; sonuç birleşik. */
export function backtestVerdict(s: OosStats): { verdict: BacktestVerdict; failed: string[] } {
  const c = FIRSAT_CRITERIA;
  if (s.n < 20) return { verdict: 'YETERSİZ VERİ', failed: ['n < 20'] };
  const failed: string[] = [];
  if (s.n < c.minN) failed.push(`n ${s.n} < ${c.minN}`);
  if (!(s.expR >= c.minExpR)) failed.push(`beklenti ${s.expR.toFixed(3)} < ${c.minExpR}R`);
  if (!(s.pf >= c.minPF)) failed.push(`PF ${s.pf.toFixed(2)} < ${c.minPF}`);
  if (!(s.ciLo > c.minCiLo)) failed.push(`GA alt sınırı ${s.ciLo.toFixed(3)} ≤ 0`);
  if (!(s.expRSpread15 > 0)) failed.push(`spread ×${c.spreadMult} beklenti ≤ 0`);
  return { verdict: failed.length ? 'KALDI' : 'GEÇTİ', failed };
}

/** "Güvenilir ✓" rozeti: backtest geçti + kâğıt testi (≥30, kazanma farkı ≤10 puan, beklenti > 0). Koşul bozulursa rozet kalkar. */
export function reliable(bt: BacktestVerdict, oosWinPct: number, paper: PaperStats): { ok: boolean; why: string } {
  const c = FIRSAT_CRITERIA;
  if (bt !== 'GEÇTİ') return { ok: false, why: 'backtest geçmedi' };
  if (paper.n < c.paperMinN) return { ok: false, why: `kâğıt n ${paper.n} < ${c.paperMinN}` };
  if (oosWinPct - paper.winPct > c.paperWinGapMax) return { ok: false, why: `kazanma farkı ${(oosWinPct - paper.winPct).toFixed(1)} puan` };
  if (!(paper.expR > 0)) return { ok: false, why: 'kâğıt beklenti ≤ 0' };
  return { ok: true, why: 'tüm kapılar geçti' };
}
