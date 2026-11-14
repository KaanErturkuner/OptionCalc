/*
 * Bilanço detay grafikleri (saf veri): Akış'ta gün bazında call/put prim, zincirde ATM straddle'dan beklenen hareket,
 * zincir çubukları (spot çevresi). Ağ ve React yok. Zincir çubukları radar/detail.ts'in strike satırlarını kullanır.
 */
import type { Chain, OptQuote } from '../market/types.ts';
import { mid } from '../market/types.ts';
import type { FlowEvent } from '../flow/model.ts';
import { strikeRows, windowRows, type StrikeRow } from '../radar/detail.ts';

export interface DayPrem { day: string; call: number; put: number }
/** Akış olaylarından (tek hisse) gün bazında call ve put primi (USD). Eskiden yeniye. */
export function flowPremByDay(events: FlowEvent[], ticker: string): DayPrem[] {
  const m = new Map<string, DayPrem>();
  for (const e of events) {
    if (e.ticker !== ticker) continue;
    const d = m.get(e.day) ?? { day: e.day, call: 0, put: 0 };
    if (e.side === 'call') d.call += e.prem; else d.put += e.prem;
    m.set(e.day, d);
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export interface ImpliedMove { strike: number; straddle: number; pct: number; lo: number; hi: number }
/**
 * Beklenen hareket: spot'a en yakın strike'ta ATM straddle (call orta + put orta) ÷ spot.
 * lo/hi = spot ∓ straddle (dolar). İki tarafın da orta fiyatı > 0 olan strike'lar aranır; yoksa null.
 */
export function impliedMove(ch: Pick<Chain, 'calls' | 'puts'>, spot: number): ImpliedMove | null {
  if (!(spot > 0)) return null;
  const puts = new Map<number, OptQuote>();
  for (const p of ch.puts) if (p.strike > 0) puts.set(p.strike, p);
  let best: { strike: number; straddle: number } | null = null;
  for (const c of ch.calls) {
    const p = puts.get(c.strike);
    if (!p || !(c.strike > 0)) continue;
    const cm = mid(c), pm = mid(p);
    if (!(cm > 0) || !(pm > 0)) continue;
    if (!best || Math.abs(c.strike - spot) < Math.abs(best.strike - spot)) best = { strike: c.strike, straddle: cm + pm };
  }
  if (!best) return null;
  return { strike: best.strike, straddle: best.straddle, pct: (best.straddle / spot) * 100, lo: spot - best.straddle, hi: spot + best.straddle };
}

export type ChainMetric = 'oi' | 'vol';
/** Zincir çubukları: spot çevresinde (±pct) en çok maxBars strike; metrik OI veya hacim. */
export function chainBars(ch: Chain, spot: number, pct = 0.12, maxBars = 40): StrikeRow[] {
  return windowRows(strikeRows(ch), spot, pct, maxBars);
}
