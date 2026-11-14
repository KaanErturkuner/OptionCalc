/* Güven skoru 0–100 (SINYAL-FIRSAT §5). Açık kurallar, bileşen dökümü, vetolar. Saf.
 * Ağırlıklar tek yerde; değişiklik yalnızca Kaan onayıyla. */
import { etToIst } from '../usmarket.ts';
export const WEIGHTS = { A1: 10, A2: 8, A3: 7, B: 10, C: 15, D: 15, E: 10, F: 5, G: 5, H: 15 } as const;
export type Dir = 'bull' | 'bear';
export type CompKey = keyof typeof WEIGHTS;
export interface ScoreInput {
  dir: Dir;
  regime: { opposite: boolean; vwapAll: boolean; orAll: boolean };                 // A1
  sector: { present: boolean; vwapOk: boolean; rsOk: boolean };                    // A2
  frames: { aligned: number };                                                      // A3 (1/5/15 dk, 0–3)
  volRatio: number;                                                                 // B
  radar: { same: number; oppMax: number };                                          // C: aynı yön Σ şiddet, ters yön en büyük şiddet (son 30 dk)
  rr: { needMove: number; remainingEm: number; pTouch: number; rr: number; minRr: number }; // D + RR vetosu
  liq: { spreadPct: number; liquid: boolean; maxSpreadPct: number };               // E
  time: { etMin: number; dte: number };                                            // F
  risk: { newsAgainst: boolean; macroNear: boolean; earningsInDte: boolean; s5: boolean }; // G
  hist: { n: number; wins: number; pBe: number };                                  // H
  data: { delayedMin: number; barAgeSec: number; chainAgeSec: number };
  marketOpen: boolean;
  budget?: { askCost: number; available: number };                                 // sermaye yetersiz vetosu
}
export interface Component { key: CompKey; label: string; pts: number; max: number; note: string }
export interface ConfidenceResult { score: number; raw: number; label: Label; components: Component[]; vetoes: string[]; cap: number | null }
export type Label = 'Zayıf' | 'Orta' | 'İyi' | 'Güçlü';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** Beta küçültme: (kazanç+2)/(n+2+2/p_be) */
export const betaPost = (wins: number, n: number, pBe: number) => (wins + 2) / (n + 2 + 2 / pBe);
export const labelOf = (s: number): Label => s < 50 ? 'Zayıf' : s < 65 ? 'Orta' : s < 80 ? 'İyi' : 'Güçlü';

export function scoreSignal(x: ScoreInput): ConfidenceResult {
  const vetoes: string[] = [], comps: Component[] = [];
  const add = (key: CompKey, pts: number, note: string) => comps.push({ key, label: LABEL[key], pts: +pts.toFixed(2), max: WEIGHTS[key], note });

  // Vetolar (skor 0, sinyal gösterilmez, yalnızca kayda geçer)
  if (x.regime.opposite) vetoes.push('ters piyasa rejimi');
  if (!x.marketOpen) vetoes.push('piyasa kapalı');
  if (x.data.chainAgeSec > 300) vetoes.push('zincir 5 dk’dan eski');
  if (x.liq.spreadPct > x.liq.maxSpreadPct) vetoes.push(`spread > %${x.liq.maxSpreadPct}`);
  if (x.rr.rr < x.rr.minRr) vetoes.push(`RR ${x.rr.rr.toFixed(2)} < alt sınır ${x.rr.minRr}`);
  if (x.time.dte === 0 && x.time.etMin >= 870) vetoes.push(`0DTE ${etToIst(14, 30)} TR sonrası`);
  if (x.risk.earningsInDte && !x.risk.s5) vetoes.push('bilanço DTE içinde');
  if (x.budget && x.budget.askCost > x.budget.available) vetoes.push('sermaye yetersiz');

  // A1 piyasa rejimi
  let a1 = x.regime.opposite ? 0 : x.regime.vwapAll && x.regime.orAll ? WEIGHTS.A1 : x.regime.vwapAll ? WEIGHTS.A1 / 2 : 0;
  // A2 sektör/akış; sektör tanımı yoksa 8 puan A1'e eklenir
  let a2 = 0; let a2note: string;
  if (x.sector.present) {
    a2 = x.sector.vwapOk && x.sector.rsOk ? WEIGHTS.A2 : x.sector.vwapOk ? WEIGHTS.A2 / 2 : 0;
    a2note = 'sektör VWAP' + (x.sector.rsOk ? ' + göreli güç' : '');
  } else { a1 += WEIGHTS.A2; a2note = 'sektör tanımı yok: puan A1’e eklendi'; }
  add('A1', a1, x.regime.opposite ? 'ters rejim' : x.regime.vwapAll && x.regime.orAll ? 'VWAP + açılış kırılımı' : x.regime.vwapAll ? 'yalnız VWAP' : 'uyumsuz');
  add('A2', x.sector.present ? a2 : 0, a2note);
  // A3 çoklu zaman dilimi
  const a3 = x.frames.aligned >= 3 ? WEIGHTS.A3 : x.frames.aligned >= 2 ? 3 : 0;
  add('A3', a3, `${x.frames.aligned}/3 zaman dilimi uyumlu`);
  // B hacim
  const b = x.volRatio >= 2 ? WEIGHTS.B : x.volRatio >= 1.5 ? WEIGHTS.B / 2 : 0;
  add('B', b, Number.isFinite(x.volRatio) ? `hacim ${x.volRatio.toFixed(2)}×` : 'hacim verisi yok');
  // C opsiyon akışı / Radar uyumu
  const cFull = WEIGHTS.C * Math.min(1, x.radar.same);
  const cPen = x.radar.oppMax >= 0.5 ? 10 : 0;
  const c = clamp(cFull - cPen, 0, WEIGHTS.C);
  add('C', c, `aynı yön Σ${x.radar.same.toFixed(2)}${cPen ? ', ters yön −10' : ''}`);
  // D RR fizibilitesi
  const r = x.rr.remainingEm > 0 ? x.rr.needMove / x.rr.remainingEm : Infinity;
  let d = r <= 0.6 ? WEIGHTS.D : r <= 1.2 ? WEIGHTS.D * (1.2 - r) / 0.6 : 0;
  if (x.rr.pTouch < 0.15) d = 0; else if (x.rr.pTouch < 0.30) d *= x.rr.pTouch / 0.30;
  add('D', d, `gereken/kalan EM ${Number.isFinite(r) ? r.toFixed(2) : '—'} · pDokunma ${(x.rr.pTouch * 100).toFixed(0)}%`);
  // E likidite
  const e = x.liq.spreadPct <= 5 && x.liq.liquid ? WEIGHTS.E : x.liq.spreadPct <= x.liq.maxSpreadPct && x.liq.liquid ? WEIGHTS.E / 2 : 0;
  add('E', e, `spread %${x.liq.spreadPct.toFixed(1)}${x.liq.liquid ? '' : ', likidite yetersiz'}`);
  // F zaman
  const f = x.time.etMin >= 585 && x.time.etMin < 720 ? WEIGHTS.F : x.time.etMin >= 720 && x.time.etMin < 780 ? 3
    : x.time.dte >= 1 && x.time.etMin >= 780 && x.time.etMin < 870 ? 3 : 0;
  add('F', f, `${Math.floor(x.time.etMin / 60)}:${String(x.time.etMin % 60).padStart(2, '0')} ET, ${x.time.dte} DTE`);
  // G haber / takvim
  const g = x.risk.newsAgainst || x.risk.macroNear ? 0 : WEIGHTS.G;
  add('G', g, x.risk.newsAgainst ? 'ters haber' : x.risk.macroNear ? 'makro olay yakın' : 'haber/takvim engeli yok');
  // H tarihsel isabet
  let h: number, hnote: string;
  if (x.hist.n < 30) { h = WEIGHTS.H / 2; hnote = `n=${x.hist.n} < 30: nötr`; }
  else { const p = betaPost(x.hist.wins, x.hist.n, x.hist.pBe); h = WEIGHTS.H * clamp((p - x.hist.pBe) / 0.15 + 0.5, 0, 1); hnote = `p_post ${(p * 100).toFixed(1)}% · başabaş ${(x.hist.pBe * 100).toFixed(1)}%`; }
  add('H', h, hnote);

  const raw = comps.reduce((s, c) => s + c.pts, 0);
  let score = raw, cap: number | null = null;
  // Veri kalitesi cezası (toplamdan sonra)
  if (x.data.delayedMin > 0) { score -= 10; cap = 70; }
  if (x.data.barAgeSec > 120) score -= 5;
  if (cap != null) score = Math.min(score, cap);
  score = Math.round(clamp(score, 0, 100));
  if (vetoes.length) score = 0;
  return { score, raw: +raw.toFixed(2), label: labelOf(score), components: comps, vetoes, cap };
}

const LABEL: Record<CompKey, string> = {
  A1: 'Piyasa rejimi', A2: 'Sektör/akış', A3: 'Zaman dilimi', B: 'Hacim', C: 'Opsiyon akışı', D: 'RR fizibilitesi',
  E: 'Likidite', F: 'Zaman', G: 'Haber/takvim', H: 'Tarihsel isabet',
};
