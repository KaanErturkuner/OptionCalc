/* Takip listesi kâr/zarar: saf hesap. Long: (şimdi − giriş) × adet × 100; short: işaret ters. */
export interface PL { perShare: number; total: number; pct: number | null }

/** price: güncel prim ($/hisse). pct: giriş primine göre yüzde (giriş ≤ 0 ise null) */
export function optionPL(entry: number, price: number, qty: number, side: 1 | -1 = 1): PL {
  const perShare = (price - entry) * side;
  return { perShare, total: perShare * qty * 100, pct: entry > 0 ? (perShare / entry) * 100 : null };
}

/** Birden çok kalemin toplam kâr/zararı ($) — fiyatı olmayanlar atlanır */
export function sumPL(rows: { total: number | null }[]): number {
  return rows.reduce((a, r) => a + (r.total ?? 0), 0);
}
