/* Fırsat (Aşama 3) ortak tipleri: setup kimlikleri, bağlam, aday, sinyal. Saf. */
import type { Bar } from '../odte/analytics.ts';
export type SetupId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
export type Dir = 'bull' | 'bear';
/** Yön eşlemesi: bull = call, bear = put */
export interface SetupCtx {
  ticker: string; now: number; etMin: number; dte: number;
  bars: Bar[];                                  // seans içi 1 dk barlar (tamamlanmış)
  S: number; em: number; emRemain: number;      // spot, günlük EM ($), kalan EM ($)
  vwap: number | null; orHi: number; orLo: number; // 15 dk açılış aralığı
  volRatio: number;                             // son bar / önceki 20 bar ortalaması
  align: { bull: boolean; bear: boolean };     // A1 + A2 tam uyumu (yön başına)
  allowed: SetupId[];
  newsImpulse?: { dir: Dir; t: number } | null; // S5
  walls?: { call: number | null; put: number | null; gexNeg: boolean } | null; // S4
  ivRank?: number | null; rv10?: number | null; atmIv?: number | null;        // S6
}
export interface SetupCandidate {
  setup: SetupId; ticker: string; dir: Dir; at: number;
  und: { entry: number; stop: number; target: number };  // dayanak seviyeleri
  reason: string[];                                        // Türkçe kısa gerekçeler
  ivMult: number;                                          // hedef IV çarpanı (S5 0,8; S6 1,05; diğer 1,0)
}
export type SetupFn = (c: SetupCtx) => SetupCandidate | null;
