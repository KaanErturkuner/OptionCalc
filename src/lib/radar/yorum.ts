/*
 * Kural tabanlı zincir yorumu (Radar detay: OI duvarları, P/C, max pain, gamma flip). Saf: React / Date.now / ağ YOK.
 * Yaklaşık ve ilkel kurallar: yön tahmini kanıtlanmış bir sinyal DEĞİLDİR. Güven en çok "orta" (yüksek asla).
 */
import type { Markers, StrikeRow } from './detail.ts';

export type Bias = 'yukarı' | 'aşağı' | 'kararsız';
export type Confidence = 'düşük' | 'orta' | 'yüksek';
export interface ChainInterpretation { summary: string; bullets: string[]; bias: Bias; confidence: Confidence }
export interface ChainInput { spot: number | null; rows: StrikeRow[]; marks: Markers; sumCallOi: number; sumPutOi: number }

export const CHAIN_CAVEAT = 'Yatırım tavsiyesi değildir.';
const NEAR_PCT = 0.02;          // OI yoğunluğu: spot ±%2
const MIN_OI = 1000;            // altında veri az sayılır
const PC_CALL = 0.7, PC_PUT = 1.4;
const MP_BAND = 0.005;          // max pain ile spot arası ±%0,5 "yakın"

const tr = (x: number, d = 2) => x.toFixed(d).replace('.', ',');
const pct = (x: number) => `%${Math.round(x * 100)}`;

/** Zincir (OI tabanlı) yorumu. Puanlama: P/C (±1), duvar kırılımı (±1), max pain konumu (±1). Bias: puan ≥ 2 yukarı, ≤ −2 aşağı. */
export function interpretChain(input: ChainInput): ChainInterpretation {
  const { spot, rows, marks, sumCallOi, sumPutOi } = input;
  const oiTot = sumCallOi + sumPutOi;
  if (spot == null || !(spot > 0) || oiTot <= 0) {
    return { summary: 'Yeterli zincir verisi yok.', bullets: ['Spot ya da açık pozisyon verisi alınamadı.', CHAIN_CAVEAT], bias: 'kararsız', confidence: 'düşük' };
  }

  let score = 0;
  const bullets: string[] = [];

  // P/C (OI)
  const pc = sumCallOi > 0 ? sumPutOi / sumCallOi : Infinity;
  const pcTxt = Number.isFinite(pc) ? tr(pc) : '—';
  if (pc <= PC_CALL) { score += 1; bullets.push(`P/C (OI) ${pcTxt}: call açık pozisyonu ağır.`); }
  else if (pc >= PC_PUT) { score -= 1; bullets.push(`P/C (OI) ${pcTxt}: put açık pozisyonu ağır.`); }
  else bullets.push(`P/C (OI) ${pcTxt}: call ve put dengeli.`);

  // Duvarlar ve spot konumu
  const { callWall: c, putWall: p } = marks;
  if (c != null && spot > c) { score += 1; bullets.push(`Spot call duvarı ${tr(c)}’in üstünde: direnç kırılmış görünüyor; sonraki seviye belirsiz.`); }
  else if (p != null && spot < p) { score -= 1; bullets.push(`Spot put duvarı ${tr(p)}’in altında: destek kırılmış görünüyor; sonraki seviye belirsiz.`); }
  else if (c != null && p != null) bullets.push(`Spot iki duvar arasında: destek (put duvarı) ${tr(p)}, direnç (call duvarı) ${tr(c)}.`);
  else bullets.push('Call ya da put duvarı hesaplanamadı (OI verisi yetersiz).');

  // Max pain (pin tartışması; kanıtlanmış değil) ve gamma flip (yaklaşık, dealer gamma varsayımı): tek maddede
  const mpParts: string[] = [];
  if (marks.maxPain != null) {
    const mp = marks.maxPain;
    if (spot < mp * (1 - MP_BAND)) { score += 1; mpParts.push(`Max pain ${tr(mp)} spotun üstünde (pin tartışılır, kanıtlanmış değil)`); }
    else if (spot > mp * (1 + MP_BAND)) { score -= 1; mpParts.push(`Max pain ${tr(mp)} spotun altında (pin tartışılır, kanıtlanmış değil)`); }
    else mpParts.push(`Max pain ${tr(mp)} spota yakın`);
  }
  if (marks.flip != null) {
    mpParts.push(spot > marks.flip
      ? `gamma flip ${tr(marks.flip)} (yaklaşık) spot üstünde: bayi gamma hareketi sönümleyebilir`
      : `gamma flip ${tr(marks.flip)} (yaklaşık) spot altında: bayi gamma hareketi büyütebilir`);
  }
  if (mpParts.length) bullets.push(mpParts.join('; ') + '.');

  // OI yoğunluğu: spot civarı ve duvar strike'ları
  const oiAt = (k: number | null) => k == null ? 0 : rows.filter(r => r.k === k).reduce((a, r) => a + r.callOi + r.putOi, 0);
  const nearOi = rows.filter(r => Math.abs(r.k / spot - 1) <= NEAR_PCT).reduce((a, r) => a + r.callOi + r.putOi, 0);
  const wallOi = oiAt(c) + (p != null && p !== c ? oiAt(p) : 0);
  bullets.push(`OI’nin ${pct(nearOi / oiTot)}’i spotun ±%2’si içinde; duvar strike’larında ${pct(wallOi / oiTot)}.`);

  const bias: Bias = score >= 2 ? 'yukarı' : score <= -2 ? 'aşağı' : 'kararsız';
  // Zincir sinyali zayıf: en çok orta; veri azsa ya da duvar yoksa düşük
  const confidence: Confidence = bias === 'kararsız' || oiTot < MIN_OI || c == null || p == null ? 'düşük' : 'orta';
  const summary = bias === 'yukarı' ? 'Yukarı eğilim (zincir).' : bias === 'aşağı' ? 'Aşağı eğilim (zincir).' : 'Kararsız (zincir).';

  return { summary: `${summary} Güven: ${confidence}.`, bullets: [...bullets.slice(0, 4), CHAIN_CAVEAT], bias, confidence };
}
