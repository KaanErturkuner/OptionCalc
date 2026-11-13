/* Takip listesi satır görünümü (saf): fiyat, kâr/zarar, vade durumu, metinler. */
import { isExpired, daysSince, istanbulStamp, occSymbol, type WatchItem } from './model.ts';
import { optionPL, type PL } from './pl.ts';
import { DAY_MS, closeMs } from '../usmarket.ts';

export interface WatchRow {
  id: string; title: string; occ: string | null; expired: boolean; daysLeft: number;
  price: number | null; pl: PL | null; underlying: number | null; underlyingAdded: number | null;
  days: number; addedStamp: string; stale: boolean;
}

/** Bir kalem için görünüm. now: ms. Vadesi dolmuşsa fiyat son bilinen değerdir (istek yapılmaz). */
export function rowOf(it: WatchItem, now: number): WatchRow {
  const expired = isExpired(it.expiry, now);
  const price = it.last?.premium ?? null;
  const pl = price != null ? optionPL(it.entry, price, it.qty, it.side) : null;
  let occ: string | null = null;
  try { occ = occSymbol(it.symbol, it.expiry, it.type, it.strike); } catch { occ = null; }
  const daysLeft = Math.max(0, Math.ceil((closeMs(it.expiry) - now) / DAY_MS));
  return {
    id: it.id, title: `${it.symbol} ${it.strike} ${it.type === 'call' ? 'C' : 'P'}`, occ, expired, daysLeft,
    price, pl, underlying: it.last?.underlying ?? null, underlyingAdded: it.underlyingAdded,
    days: daysSince(it.addedAt, now), addedStamp: istanbulStamp(Date.parse(it.addedAt), true),
    // son güncelleme 30 dk'dan eskiyse ve vade açıksa "bayat" say (seans içinde)
    stale: !expired && !!it.last && now - it.last.at > 30 * 60000,
  };
}

/** Toplam kâr/zarar: fiyatı olmayan kalemler sayılmaz; tüm kalemler için eksik sayısı da döner */
export function totals(rows: WatchRow[]): { total: number; missing: number } {
  let total = 0, missing = 0;
  for (const r of rows) { if (r.pl) total += r.pl.total; else missing++; }
  return { total, missing };
}
