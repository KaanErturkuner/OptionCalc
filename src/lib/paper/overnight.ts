/* 1–3 DTE pozisyonun gece taşınması, gece riski ve ertesi sabah gap yönetimi — SINYAL-FIRSAT §7.8, K4. Saf.
 * 0DTE her zaman 15:45 ET'de kapanır. Fiyatlayıcı enjekte edilebilir (testler için). */
import { americanPrice, FAST_STEPS, type OptType } from '../american.ts';
import { closeMs, exDivMs, addDaysStr, isTradingDay, YEAR_MS } from '../usmarket.ts';
import type { OpenPosition } from './types.ts';
import { RATE } from '../signals/rr.ts';

export const GAP_BAD_R_MAX = 1.5;       // kötü senaryo kaybı ≤ 1,5R ise taşınır
export const NIGHT_SIGMA_MULT = 2;      // kötü senaryo: 2 × σ_gece (pozisyon aleyhine)
export const NIGHT_IV_MULT = 0.9;       // kötü senaryoda IV × 0,9

export type Pricer = (type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number,
  divs: never[], steps: number) => number;
const defaultPricer: Pricer = (type, S, K, T, r, q, sigma, divs, steps) => americanPrice(type, S, K, T, r, q, sigma, divs, steps);

/** Sonraki işlem günü (ET tarih). Hafta sonu ve tatiller atlanır. */
export function nextTradingDay(day: string): string {
  let d = addDaysStr(day, 1);
  while (!isTradingDay(d)) d = addDaysStr(d, 1);
  return d;
}

/** Ertesi açılış (09:30 ET) ms. */
export const nextOpenMs = (day: string): number => exDivMs(nextTradingDay(day));

/** σ_gece = S × IV × √(Δt / yıl); Δt = 16:00 ET kapanıştan sonraki açılışa kadar takvim süresi (hafta sonu ~65 saat). */
export function sigmaNight(S: number, ivAtm: number, day: string): number {
  const dt = Math.max(0, nextOpenMs(day) - closeMs(day)) / YEAR_MS;
  return S * ivAtm * Math.sqrt(dt);
}

export interface OvernightInput {
  pos: OpenPosition;
  day: string;                  // bugünkü işlem günü (ET)
  S: number;                    // dayanak (kapanış)
  ivAtm: number;                // ATM IV (ondalık)
  eventBeforeOpen: boolean;     // bilanço veya makro (FOMC/CPI/NFP) açılıştan önce
  strongTriggerLast30: boolean; // son 30 dk'da güçlü risk tetiği
  regimeAligned: boolean;       // rejim pozisyon yönünde
  pricer?: Pricer;
}

export interface OvernightDecision {
  carry: boolean;
  reasons: string[];            // taşınamama nedenleri (Türkçe)
  sigma: number;
  badLoss: number;              // kötü senaryo kaybı ($)
  badR: number;                 // kötü senaryo kaybı (R)
}

/** Gece kararı (15:45 ET). Tüm ön koşullar sağlanırsa taşınır; kötü senaryo ≤ 1,5R şart. */
export function overnightDecision(i: OvernightInput): OvernightDecision {
  const p = i.pos, reasons: string[] = [];
  const sigma = sigmaNight(i.S, i.ivAtm, i.day);
  if (p.dte < 1) reasons.push('0DTE gün bitmeden kapanır');
  const next = nextTradingDay(i.day);
  if (p.expiry < next) reasons.push('vade ertesi seanstan önce');
  if (i.eventBeforeOpen) reasons.push('açılıştan önce bilanço veya makro olay');
  if (i.strongTriggerLast30) reasons.push('son 30 dk güçlü risk tetiği');
  if (!i.regimeAligned) reasons.push('rejim pozisyon yönünde değil');
  if (!(i.ivAtm > 0) || !Number.isFinite(i.S)) reasons.push('IV/dayanak verisi yok (gece riski hesaplanamaz)');

  // Kötü senaryo: dayanak 2σ aleyhe, IV × 0,9, vadeye kalan süre ertesi açılışta.
  const pricer = i.pricer ?? defaultPricer;
  const dirSign = p.dir === 'call' ? 1 : -1;
  const Sadv = i.S - dirSign * NIGHT_SIGMA_MULT * sigma;
  const T = Math.max(1e-6, (closeMs(p.expiry) - nextOpenMs(i.day)) / YEAR_MS);
  const value = pricer(p.dir, Math.max(1e-6, Sadv), p.strike, T, RATE, 0, i.ivAtm * NIGHT_IV_MULT, [], FAST_STEPS);
  const badLoss = Math.max(0, p.costBasis - value * 100 * p.contracts);
  const badR = p.rDollars > 0 ? badLoss / p.rDollars : Infinity;
  if (badR > GAP_BAD_R_MAX) reasons.push(`kötü senaryo ${badR.toFixed(1)}R > 1,5R`);
  return { carry: reasons.length === 0, reasons, sigma, badLoss, badR };
}

export interface GapInput {
  pos: OpenPosition;
  openUnd: number;        // ertesi sabah ilk tamamlanmış 1 dk barın açılış dayanağı (09:31)
  openBid: number;        // aynı andaki alınabilir bid
  stopUnd: number;        // dayanak stop
  etMin: number;          // ET dk (09:31 = 571)
}

export type GapAction = { action: 'gap-close' | 'manage' | 'wait'; reason?: 'gap' | 'stop' };

/**
 * Ertesi sabah gap yönetimi (§7.8):
 *  1) açılış dayanak stopunun ötesindeyse → gap çıkışı (ilk alınabilir bid − kayma; kayıp R'yi aşabilir).
 *  2) prim %67 tavanının altında açıldıysa → gap çıkışı.
 *  3) 09:30–09:45 arası yalnız stop ve hedef çalışır; T1–T7 09:45'ten sonra (`wait` döner, çağıran stop/hedefi yine kontrol eder).
 *  4) lehte gap → iz süren stop (`manage`).
 */
export function gapOpenAction(g: GapInput, dirSign: 1 | -1): GapAction {
  if (dirSign * (g.openUnd - g.stopUnd) <= 0) return { action: 'gap-close', reason: 'gap' };
  if (g.openBid <= g.pos.stopPrem) return { action: 'gap-close', reason: 'gap' };
  if (g.etMin < 585) return { action: 'wait' };   // 09:45 öncesi: açılış gürültüsü (T1–T7 devre dışı)
  return { action: 'manage' };
}
