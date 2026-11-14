/*
 * Bilanço takvimi (saf): anahtarsız takvim yanıtının ayrıştırılması, saat dilimine göre gruplama, tarih şeridi.
 * Ağ çağrısı src/lib/earnings/fetch.ts'te. Piyasa öncesi = time-pre-market, sonrası = time-after-hours.
 */
import { addDaysStr, etDate, isTradingDay } from '../usmarket.ts';
import type { OptQuote } from '../market/types.ts';

export type EarnTiming = 'pre' | 'post' | 'unknown';
export interface EarningsRow {
  symbol: string; name: string; timing: EarnTiming;
  epsForecast: number | null; estimates: number | null;
  lastYearEps: number | null; lastYearDate: string | null; marketCap: string | null;
}

/** "$2.50" → 2.5; "(0.12)" → −0.12; boş / "N/A" → null */
export function parseUsd(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^n\/?a$/i.test(t) || t === '--') return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[^0-9.]/g, ''));
  return isFinite(n) && t.match(/\d/) ? (neg ? -n : n) : null;
}
export const timingOf = (code: unknown): EarnTiming =>
  code === 'time-pre-market' ? 'pre' : code === 'time-after-hours' ? 'post' : 'unknown';

/** Nasdaq benzeri takvim JSON'u → satırlar. Yapı: { data: { rows: [...] } } */
export function parseEarningsCalendar(json: unknown): EarningsRow[] {
  const rows = (json as { data?: { rows?: unknown[] } })?.data?.rows;
  if (!Array.isArray(rows)) return [];
  const out: EarningsRow[] = [];
  for (const r0 of rows) {
    const r = r0 as Record<string, unknown>;
    const symbol = typeof r.symbol === 'string' ? r.symbol.trim().toUpperCase() : '';
    if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) continue;
    out.push({
      symbol, name: typeof r.name === 'string' ? r.name.trim() : symbol, timing: timingOf(r.time),
      epsForecast: parseUsd(r.epsForecast), estimates: parseUsd(r.noOfEsts),
      lastYearEps: parseUsd(r.lastYearEPS), lastYearDate: typeof r.lastYearRptDt === 'string' ? r.lastYearRptDt : null,
      marketCap: typeof r.marketCap === 'string' ? r.marketCap : null,
    });
  }
  return out;
}

/** Piyasa öncesi / sonrası / saat belirtilmemiş gruplar; her grupta sembole göre sıralı */
export function groupByTiming(rows: EarningsRow[]): Record<EarnTiming, EarningsRow[]> {
  const g: Record<EarnTiming, EarningsRow[]> = { pre: [], post: [], unknown: [] };
  for (const r of rows) g[r.timing].push(r);
  for (const k of ['pre', 'post', 'unknown'] as EarnTiming[]) g[k].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return g;
}

/** Tarih şeridi: bugünden önceki `back` işlem günü, bugün (işlem günüyse) ve sonraki `fwd` işlem günü. Hafta sonu/tatil atlanır. */
export function tradingStrip(nowMs: number, back = 2, fwd = 7): string[] {
  const today = etDate(nowMs);
  const before: string[] = [];
  for (let d = addDaysStr(today, -1); before.length < back; d = addDaysStr(d, -1)) if (isTradingDay(d)) before.unshift(d);
  const after: string[] = [];
  for (let d = isTradingDay(today) ? addDaysStr(today, 1) : today; after.length < fwd; d = addDaysStr(d, 1)) if (isTradingDay(d)) after.push(d);
  return [...before, ...(isTradingDay(today) ? [today] : []), ...after];
}

export interface ChainSummary { expiry: string; callOi: number; putOi: number; callVol: number; putVol: number; topCalls: OptQuote[]; topPuts: OptQuote[] }
/** En yakın vade zincirinden OI/hacim özeti ve OI'ye göre en yoğun 4 strike (çağrı ve put) */
export function summarizeChain(expiry: string, calls: OptQuote[], puts: OptQuote[]): ChainSummary {
  const sum = (l: OptQuote[], k: 'oi' | 'volume') => l.reduce((a, o) => a + (o[k] || 0), 0);
  const top = (l: OptQuote[]) => [...l].filter(o => o.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, 4);
  return { expiry, callOi: sum(calls, 'oi'), putOi: sum(puts, 'oi'), callVol: sum(calls, 'volume'), putVol: sum(puts, 'volume'), topCalls: top(calls), topPuts: top(puts) };
}
