/* Pozisyon boyutu ve kademe (%50 → %40 → %30; azami %50) — SINYAL-FIRSAT §7.2. Saf.
 * %50 azami Kaan'ın bilinçli kararıdır: bu dosyada değer değiştirilmez, gizli tavan eklenmez. */
import type { Kademe, TradeResult } from './types.ts';
import { DEFAULT_COMMISSION } from './costs.ts';

/** Kademe basamakları, küçükten büyüğe. */
export const KADEMELER: readonly Kademe[] = [0.3, 0.4, 0.5] as const;
export const MAX_KADEME: Kademe = 0.5;
export const MIN_KADEME: Kademe = 0.3;
export const START_KADEME: Kademe = 0.5;

/**
 * Bir işlem sonucundan sonra kademe.
 * Kazanç: bir adım yükselir (azami 50). Kayıp: bir adım düşer (en az 30). Başabaş: değişmez.
 */
export function kademeAfter(k: Kademe, result: TradeResult): Kademe {
  const i = KADEMELER.indexOf(k);
  if (i < 0) throw new Error(`geçersiz kademe: ${k}`);
  if (result === 'kazanc') return KADEMELER[Math.min(i + 1, KADEMELER.length - 1)];
  if (result === 'kayip') return KADEMELER[Math.max(i - 1, 0)];
  return k;
}

/** Bütçe = mevcut sermaye × kademe. */
export const budgetFor = (capital: number, k: Kademe): number => Math.max(0, capital) * k;

export interface Sizing {
  budget: number;      // ($) kademe bütçesi
  contracts: number;   // adet (kesirli simülasyonda ondalıklı)
  cost: number;        // adet × (fill × 100) + açılış komisyonu ($) — her zaman ≤ budget
  openComm: number;    // açılış komisyonu toplamı ($)
}

/**
 * Adet: floor(bütçe / (fill × 100 + komisyon)). Kesirli kapalıyken tam kontrat.
 * fill = giriş dolumu (ask + kayma); kayma dâhil hesaplandığı için maliyet bütçeyi aşmaz.
 * Adet 0 ise işlem açılmaz ("sermaye yetmiyor").
 */
export function sizePosition(capital: number, k: Kademe, fill: number,
  opts: { commission?: number; fractional?: boolean } = {}): Sizing {
  const comm = opts.commission ?? DEFAULT_COMMISSION;
  const budget = budgetFor(capital, k);
  const per = fill * 100 + comm;
  if (!(per > 0) || !Number.isFinite(per)) return { budget, contracts: 0, cost: 0, openComm: 0 };
  const raw = budget / per;
  const contracts = opts.fractional ? Math.max(0, raw) : Math.max(0, Math.floor(raw + 1e-9));
  return { budget, contracts, cost: contracts * per, openComm: contracts * comm };
}
