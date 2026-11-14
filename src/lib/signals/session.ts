/* Seans zamanı, vadeye kalan işlem dakikası, günlük/kalan EM ve T0 — SINYAL-FIRSAT §6. Saf. */
import { etOffset, etDate, isTradingDay, addDaysStr, isEarlyCloseDay } from '../usmarket.ts';
import { MIN_PER_YEAR } from './rr.ts';

export const SESSION_MIN = 390;
export const CLOSE_MIN = 16 * 60; // 16:00 ET

/** ET dakika (0–1439), DST dahil. */
export function etMinutes(now: number): number {
  const shifted = now + etOffset(now) * 3600000;
  return Math.floor(((shifted % 86400000) + 86400000) % 86400000 / 60000);
}

/** Kalan seans dakikası (09:30–16:00 ET). Hafta sonu/tatil veya kapanış sonrası: 0. Açılış öncesi: 390. */
export function sessionLeftMin(now: number): number {
  if (!isTradingDay(etDate(now))) return 0;
  const close = isEarlyCloseDay(etDate(now)) ? 13 * 60 : CLOSE_MIN;   // NYSE erken kapanış: 13:00 ET
  return Math.min(SESSION_MIN, Math.max(0, close - etMinutes(now)));
}

/** (from, to] arası işlem günü sayısı (from hariç, to dahil). */
export function tradingDaysAfter(from: string, to: string): number {
  let n = 0;
  for (let d = addDaysStr(from, 1); d <= to; d = addDaysStr(d, 1)) if (isTradingDay(d)) n++;
  return n;
}

/** Vadeye kalan işlem dakikası: bugünün kalanı + ara seanslar (hafta sonu/tatil sayılmaz). */
export function timeToExpiryMin(today: string, expiry: string, leftMin: number): number {
  return Math.max(0, tradingDaysAfter(today, expiry) * SESSION_MIN + Math.max(0, leftMin));
}

export function timeToExpiryYears(toExpMin: number): number {
  return Math.max(1e-6, toExpMin / MIN_PER_YEAR);
}

/**
 * Canlı ATM straddle vadeye kadarki beklenen harekettir.
 * Günlük EM ve kalan (seans) EM, toplam işlem dakikasına √t ile ölçeklenir.
 * 0DTE'de emRemain = straddle (canlı fiyat zaten kalan süreyi içerir; tekrar küçültülmez).
 */
export function scaleEm(straddle: number, leftMin: number, toExpMin: number): { emDay: number; emRemain: number } {
  if (!Number.isFinite(straddle)) return { emDay: NaN, emRemain: NaN };
  if (!(toExpMin > 0)) return { emDay: straddle, emRemain: 0 };
  return {
    emDay: straddle * Math.sqrt(SESSION_MIN / toExpMin),
    emRemain: straddle * Math.sqrt(Math.max(0, leftMin) / toExpMin),
  };
}
