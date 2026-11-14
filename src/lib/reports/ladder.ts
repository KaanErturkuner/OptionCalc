/*
 * Kompakt duvar merdiveni (saf): bir WallRow'un seviyelerini dikey fiyat ekseninde yerleştirir. Strike-düzeyinde OI
 * saklanmadığı için (geçmiş zincir yalnız özet tutar) radar merdiveninin çubuklu hâli değil, işaret çizgili bir varyanttır.
 * Üst = yüksek fiyat. Etiketler birbirine girmesin diye minimum dikey aralık uygulanır.
 */
import type { WallRow } from './types.ts';

export type MarkKey = 'spot' | 'callWall' | 'putWall' | 'gammaFlip' | 'maxPain';
export const MARK_LABEL: Record<MarkKey, string> = { spot: 'Spot', callWall: 'Call', putWall: 'Put', gammaFlip: 'Flip', maxPain: 'Max pain' };

export interface LadderMark { key: MarkKey; label: string; price: number; y: number }
export interface LadderLayout { lo: number; hi: number; marks: LadderMark[] }

/**
 * Yerleşim: fiyat aralığı (%0,5 pay) → yükseklik; çakışan etiketler minGap px aralıkla ayrılır (sıra korunur).
 * Veri yoksa marks boş ve lo = hi = 0. height ve minGap px; pad üst/alt boşluk.
 */
export function ladderLayout(row: WallRow, height: number, pad = 10, minGap = 13): LadderLayout {
  const raw: { key: MarkKey; price: number }[] = [];
  const push = (key: MarkKey, v: number | null) => { if (v != null && Number.isFinite(v) && v > 0) raw.push({ key, price: v }); };
  push('spot', row.spot); push('callWall', row.callWall); push('putWall', row.putWall); push('gammaFlip', row.gammaFlip); push('maxPain', row.maxPain);
  if (!raw.length) return { lo: 0, hi: 0, marks: [] };
  let lo = Math.min(...raw.map(r => r.price)), hi = Math.max(...raw.map(r => r.price));
  if (hi === lo) { lo -= 1; hi += 1; }
  const pay = (hi - lo) * 0.005;
  lo -= pay; hi += pay;
  const span = Math.max(1, height - 2 * pad);
  const yOf = (p: number) => pad + ((hi - p) / (hi - lo)) * span;
  const sorted = raw.map(r => ({ key: r.key, label: MARK_LABEL[r.key], price: r.price, y: yOf(r.price) })).sort((a, b) => a.y - b.y);
  // İleri geçiş: çakışanları aşağı it; sonra alt sınıra sığmayanı yukarı çek
  for (let i = 1; i < sorted.length; i++) if (sorted[i].y - sorted[i - 1].y < minGap) sorted[i].y = sorted[i - 1].y + minGap;
  const maxY = height - pad;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].y > maxY) sorted[i].y = maxY;
    if (i < sorted.length - 1 && sorted[i + 1].y - sorted[i].y < minGap) sorted[i].y = sorted[i + 1].y - minGap;
  }
  return { lo, hi, marks: sorted };
}
