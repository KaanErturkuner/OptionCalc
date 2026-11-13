/* Maliyet modeli: komisyon, kayma, dolum, likidite — SINYAL-FIRSAT §7.5. Saf. */

/** Aracı komisyonları (kontrat başına, açılış ve kapanışta ayrı ayrı). */
export const BROKER_COMMISSION = { midas: 1.5, ibkr: 0.65 } as const;
/** Varsayılan: Midas 1,50 $ (Kaan 2026-11-13). Tek kaynak. */
export const DEFAULT_COMMISSION: number = BROKER_COMMISSION.midas;
export const DEFAULT_SLIPPAGE = 0.01;
/** Ask ≤ bu değer olan kontratlar alınmaz (likidite, §7.5). */
export const MIN_ASK = 0.05;

/** Giriş dolumu: ask + kayma. */
export const entryFill = (ask: number, slip = DEFAULT_SLIPPAGE): number => ask + slip;

/** Çıkış dolumu: bid − kayma (en az 0). */
export const exitFill = (bid: number, slip = DEFAULT_SLIPPAGE): number => Math.max(0, bid - slip);

/** Alınabilir mi? (ask > MIN_ASK ve sonlu) */
export const isTradable = (ask: number): boolean => Number.isFinite(ask) && ask > MIN_ASK;

/**
 * Gecikmeli zincirde giriş fiyatı (§7.5): max(gecikmeli ask, model fiyatı şimdiki spot ile + yarım spread).
 * Model fiyatı yoksa gecikmeli ask kullanılır.
 */
export function delayedEntryAsk(delayedAsk: number, modelNow: number | null, halfSpread: number): number {
  if (modelNow === null || !Number.isFinite(modelNow)) return delayedAsk;
  return Math.max(delayedAsk, modelNow + Math.max(0, halfSpread));
}

/** Açılış + kapanış komisyonu (gidiş-dönüş), kontrat sayısına göre. */
export const roundTripCommission = (contracts: number, comm = DEFAULT_COMMISSION): number => 2 * comm * contracts;

/** Net K/Z: (çıkış − giriş) × 100 × adet − açılış komisyonu − kapanış komisyonu. */
export function netPnl(fill: number, exit: number, contracts: number, comm = DEFAULT_COMMISSION): number {
  return (exit - fill) * 100 * contracts - 2 * comm * contracts;
}
