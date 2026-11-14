/* Açık pozisyon risk izleyicisi: T1–T7 tetikleri, iz süren stop, uyarı/çıkış kararı — SINYAL-FIRSAT §7.3. Saf.
 * Çıkışlar onay beklemez (kâğıt hesapta otomatik). Tetik fonksiyonları girdiyi hazır alır; veri çekmez. */
import type { Bar } from '../odte/analytics.ts';
import type { OpenPosition, PaperMode, ExitReason } from '../paper/types.ts';
import type { AdaptiveDecision } from './adaptive.ts';

export const PRIM_STOP_MAX = 0.67;      // Kaan kararı (§6.1, K5, D8)
export const RANGE_BODY_MIN = 0.6;      // T1: gövde/aralık
export const VOL_SPIKE = 2;             // T1 ve §7.3 hacim oranı
export const IV_DROP = 0.15;            // T5
export const THETA_LEFT_MIN = 60;       // T6: 0DTE'de kalan dk
export const THETA_DIST_EM = 0.3;       // T6: hedefe kalan mesafe > 0,3 × EMr
export const LEVEL_NEAR_EM = 0.1;       // T7
export const EOD_FORCE_ET_MIN = 15 * 60 + 45; // 15:45 ET zorunlu zaman çıkışı (0DTE ve vade günü)

export type TriggerId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7';
export const STRONG: TriggerId[] = ['T1', 'T2', 'T3'];
export const WEAK: TriggerId[] = ['T4', 'T5', 'T6', 'T7'];
/** Tetiklerin Türkçe adları (ekran ve bildirim). */
export const TRIGGER_AD: Record<TriggerId, string> = {
  T1: 'ters mum', T2: 'VWAP kaybı', T3: 'rejim dönüşü', T4: 'momentum uyumsuzluğu', T5: 'IV düşüşü', T6: 'teta/zaman', T7: 'kilit seviye',
};

/** Dayanak stopu ile %67 prim tavanından hangisi yüksekse (daha sıkı) onu al. */
export const effectiveStopPrem = (fill: number, dayanakStopPrem: number, pmax = PRIM_STOP_MAX): number =>
  Math.max(dayanakStopPrem, fill * (1 - pmax));

/** Mod hedefi (R): AGRESIF 5, Yedek 1:4 → 4, güvenli 2 (RR ≥ 2 ise) veya 1,5. */
export function modeTargetR(mode: PaperMode, rr: number): number {
  if (mode === 'AGRESIF') return 5;
  if (mode === 'AGRESIF_4') return 4;
  return rr >= 2 ? 2 : 1.5;
}

/** Çıkış kâr eşiği (R): normalde 2R, güvenli modlarda 1R (§7.3). */
export const exitThresholdR = (mode: PaperMode): number => (mode === 'GUVENLI_KAR' || mode === 'GUVENLI_ZARAR' ? 1 : 2);

/** T1 Ters mum: pozisyona ters, gövde/aralık ≥ 0,6, hacim oranı ≥ 2. (`dirSign`: +1 call, −1 put.) */
export function t1ReversalCandle(bar: Bar, dirSign: 1 | -1, volRatio: number): boolean {
  const range = bar.h - bar.l;
  if (!(range > 0)) return false;
  const against = dirSign > 0 ? bar.c < bar.o : bar.c > bar.o;
  return against && Math.abs(bar.c - bar.o) / range >= RANGE_BODY_MIN && volRatio >= VOL_SPIKE;
}

/** T2 VWAP kaybı: 1 dk kapanış VWAP'ın ters tarafında. */
export const t2VwapLoss = (close: number, vwap: number | null, dirSign: 1 | -1): boolean =>
  vwap !== null && dirSign * (close - vwap) < 0;

/** T3 Rejim dönüşü: birincil rejim sembolü pozisyonun ters tarafında. `regimeSide` +1/−1/null (belirsiz). */
export const t3RegimeFlip = (regimeSide: 1 | -1 | null, dirSign: 1 | -1): boolean =>
  regimeSide !== null && regimeSide === -dirSign;

/** T4 Momentum uyumsuzluğu: yeni tepe/dip ama RSI ve itiş hacmi düştü. */
export const t4MomentumDivergence = (newExtreme: boolean, rsiNow: number, rsiPrev: number, volNow: number, volPrev: number): boolean =>
  newExtreme && rsiNow < rsiPrev && volNow < volPrev;

/** T5 IV düşüşü: girişten beri kontrat IV'si ≥ %15 düştü ve prim son 5 dk'da artmadı. */
export const t5IvDrop = (entryIv: number, nowIv: number, premNow: number, prem5mAgo: number): boolean =>
  entryIv > 0 && (entryIv - nowIv) / entryIv >= IV_DROP && premNow <= prem5mAgo;

/** T6 Teta / zaman: 0DTE'de kalan < 60 dk ve hedefe kalan > 0,3 × EMr. */
export const t6Theta = (dte: number, leftMin: number, distToTarget: number, emRemain: number): boolean =>
  dte === 0 && leftMin < THETA_LEFT_MIN && distToTarget > THETA_DIST_EM * emRemain;

/** T7 Kilit seviye: fiyat yön üstündeki OI duvarına/günün uç noktasına 0,1 × EM yakın ve fitilli ret mumu. */
export const t7KeyLevel = (price: number, level: number | null, em: number, wickRejection: boolean): boolean =>
  level !== null && Math.abs(price - level) <= LEVEL_NEAR_EM * em && wickRejection;

export function strongWeakCount(flags: Partial<Record<TriggerId, boolean>>): { strong: TriggerId[]; weak: TriggerId[] } {
  return {
    strong: STRONG.filter(t => flags[t]),
    weak: WEAK.filter(t => flags[t]),
  };
}

/** Tetik kararı: en az 1 güçlü veya 2 zayıf. */
export const triggered = (c: { strong: TriggerId[]; weak: TriggerId[] }): boolean => c.strong.length >= 1 || c.weak.length >= 2;

/** Pozisyon kârı R cinsinden (kontrat başına fiyat farkı / kontrat başına risk). */
export const profitR = (pos: Pick<OpenPosition, 'fill' | 'rPrice'>, bid: number): number =>
  pos.rPrice > 0 ? (bid - pos.fill) / pos.rPrice : 0;

/** İz süren stop (§7.3): kâr ≥2R → +1R; ≥3R → +2R; ≥4R → +3R. En yüksek görülen kâra göre. Kontrat başına prim. */
export function trailPrem(pos: Pick<OpenPosition, 'fill' | 'rPrice' | 'stopPrem0' | 'stopPrem'>, maxR: number): number {
  const lockR = maxR >= 4 ? 3 : maxR >= 3 ? 2 : maxR >= 2 ? 1 : 0;
  if (lockR === 0) return pos.stopPrem;   // 2R altında iz süren stop yoktur
  return Math.max(pos.stopPrem, pos.fill + lockR * pos.rPrice);
}

export interface TickInput {
  bid: number;
  etMin: number;
  mode: PaperMode;
  flags: Partial<Record<TriggerId, boolean>>;
  /** Uyarlanabilir çıkış (adaptive.ts). Tanımlıysa T1/T2/T3 yerine kullanılır (ÇIK/TUT/DİKKAT). Tanımsızsa eski T1–T7 davranışı. */
  adaptive?: AdaptiveDecision | null;
}

export interface RiskDecision {
  action: 'hold' | 'warn' | 'close';
  reason?: ExitReason;
  /** Güncellenmiş pozisyon alanları (maxR, stopPrem, warned, adaptive). */
  pos: OpenPosition;
  triggers: TriggerId[];
  message?: string;          // Türkçe bildirim metni (kısa)
  adaptive?: AdaptiveDecision | null;
}

/**
 * Tek tick kararı. Sıra: hedef → stop (iz süren dâhil, %67 prim stopu) → 15:45 zorunlu çıkış → uyarlanabilir ÇIK
 * → risk tetikleri (T4–T7 ve, uyarlanabilir yoksa, T1–T3). ÇIK her kâr düzeyinde çıkarır; TUT/DİKKAT çıkarmaz.
 * Kâr ≥ eşik + tetik → çıkış. 1R–eşik arası + tetik → uyarı, stop girişe; ikinci tetik → çıkış.
 */
export function evaluatePosition(pos: OpenPosition, t: TickInput): RiskDecision {
  const flags = t.adaptive === undefined ? t.flags : { ...t.flags, T1: false, T2: false, T3: false };
  const trig = strongWeakCount(flags);
  const triggers = [...trig.strong, ...trig.weak];
  const R = profitR(pos, t.bid);
  const maxR = Math.max(pos.maxR, R);
  let next: OpenPosition = { ...pos, maxR };
  next.stopPrem = trailPrem(next, maxR);
  if (next.warned) next.stopPrem = Math.max(next.stopPrem, next.fill); // uyarıdan sonra stop en az girişte
  if (t.adaptive) next.adaptive = t.adaptive.verdict;
  const ad = t.adaptive ?? null;

  if (t.bid >= pos.targetPrem) return { action: 'close', reason: 'hedef', pos: next, triggers, message: 'hedefe ulaşıldı', adaptive: ad };
  if (t.bid <= next.stopPrem) {
    const reason: ExitReason = next.stopPrem > pos.stopPrem0 ? 'iz-suren-stop' : 'stop';
    return { action: 'close', reason, pos: next, triggers, message: 'stop vurdu', adaptive: ad };
  }
  if (pos.dte === 0 && t.etMin >= EOD_FORCE_ET_MIN) return { action: 'close', reason: 'zaman', pos: next, triggers, message: '15:45 zorunlu çıkış', adaptive: ad };
  if (ad?.verdict === 'CIK') return { action: 'close', reason: 'risk', pos: next, triggers, message: ad.reason, adaptive: ad };
  const note = ad?.verdict === 'DIKKAT' ? ad.reason : undefined;

  if (!triggered(trig)) return { action: 'hold', pos: next, triggers, message: note, adaptive: ad };
  const threshold = exitThresholdR(t.mode);
  if (R >= threshold) {
    return { action: 'close', reason: 'risk', pos: next, triggers, message: `risk artıyor, çıkıyorum (kâr ${R.toFixed(1)}R)`, adaptive: ad };
  }
  if (R >= 1) {
    if (next.warned) return { action: 'close', reason: 'risk', pos: next, triggers, message: `risk artıyor, çıkıyorum (kâr ${R.toFixed(1)}R)`, adaptive: ad };
    next = { ...next, warned: true, stopPrem: Math.max(next.stopPrem, next.fill) };
    return { action: 'warn', pos: next, triggers, message: `risk artıyor, stop girişe çekildi (kâr ${R.toFixed(1)}R)`, adaptive: ad };
  }
  return { action: 'hold', pos: next, triggers, message: note, adaptive: ad };
}
