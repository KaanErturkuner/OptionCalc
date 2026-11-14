/*
 * Rapor kuralları (saf): eğilim eşiği, açılış/seans yönü, CALL/PUT/BEKLE kararı, "veri alınamadı" metni.
 * Hem düz metin (text.ts) hem yapılandırılmış bölümler (sections.ts) bu tek kaynağı kullanır.
 */
import { fmt } from '../format.ts';
import type { Bias, Move } from './types.ts';

export const NA = 'veri alınamadı';

/** Yüzde metni: +0,42% / −1,20% (U+2212); veri yoksa "veri alınamadı" */
export const pctTr = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? NA : `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), 2)}%`;

/** Eğilim eşiği (%): bunun altındaki hareket "yatay" sayılır */
export const BIAS_BAND = 0.25;

const avgOf = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Açılış eğilimi (kural): vadeliler ağırlıklı (%70), Asya/Avrupa ortalaması (%30). Veri yoksa null. */
export function openBias(futures: Move[], asiaEu: Move[]): { label: string; score: number } | null {
  const f = avgOf(futures.map(m => m.pct)), a = avgOf(asiaEu.map(m => m.pct));
  if (f == null && a == null) return null;
  const score = f != null && a != null ? 0.7 * f + 0.3 * a : (f ?? a)!;
  return { score: +score.toFixed(2), label: score >= BIAS_BAND ? 'yukarı açılış eğilimi' : score <= -BIAS_BAND ? 'aşağı açılış eğilimi' : 'yatay / karışık açılış' };
}

/** Seans içi yön (watch listesi açılıştan beri / gün değişimi ortalaması) */
export function intraDirection(moves: Move[]): { label: string; avg: number | null } {
  const avg = avgOf(moves.map(m => m.pct));
  if (avg == null) return { label: NA, avg: null };
  return { avg: +avg.toFixed(2), label: avg >= BIAS_BAND ? 'yukarı' : avg <= -BIAS_BAND ? 'aşağı' : 'yatay' };
}

/**
 * Skordan karar: eşiğin üstü CALL, altı PUT, arası BEKLE. Skor yoksa (veri yok) BEKLE + dataOk=false.
 * Tek kural tüm raporlar için; eşik BIAS_BAND.
 */
export function biasOf(score: number | null): { bias: Bias; dataOk: boolean } {
  if (score == null || !Number.isFinite(score)) return { bias: 'BEKLE', dataOk: false };
  if (score >= BIAS_BAND) return { bias: 'CALL', dataOk: true };
  if (score <= -BIAS_BAND) return { bias: 'PUT', dataOk: true };
  return { bias: 'BEKLE', dataOk: true };
}
