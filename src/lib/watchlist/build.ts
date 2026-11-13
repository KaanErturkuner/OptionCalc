/* Hesapla bacaklarından takip kalemi üretimi (saf). Hisse bacakları atlanır; opsiyonun primi dışarıdan verilir. */
import type { Leg } from '../strategy.ts';
import type { NewItem } from './model.ts';

/** entryOf: bacağın ekleme anındaki primi ($/hisse) — Calc'ta legEntry (zincir/girilen/teorik) */
export function legsToItems(legs: Leg[], symbol: string, S: number, entryOf: (l: Leg) => number): NewItem[] {
  return legs
    .filter(l => l.kind !== 'stock' && l.qty > 0 && l.strike > 0)
    .map(l => ({
      symbol, expiry: l.expiry, strike: l.strike, type: l.kind as 'call' | 'put',
      side: l.side > 0 ? 1 : -1, qty: Math.round(l.qty),
      entry: Math.max(0, +entryOf(l).toFixed(2)),
      entrySrc: l.live ? 'zincir' : l.premium != null ? 'girilen' : 'teorik',
      underlyingAdded: S > 0 ? S : null,
    }) as NewItem);
}
