/*
 * Akış vade seçimi: bugünün vadesi (0DTE, işlem günüyse) + 3 ay içindeki her Cuma vadesi.
 * Cuma tatilse bir önceki işlem günü (ör. 2027-03-26 Kutsal Cuma → 2027-03-25 Perşembe). Diğer vadeler atlanır.
 * Saf: usmarket.ts takvimini kullanır.
 */
import { addDaysStr, DAY_MS, etDate, isTradingDay, prevTradingDay } from '../usmarket.ts';

export interface FlowTarget { date: string; dte: number; zero: boolean }

const dow = (s: string) => new Date(s + 'T12:00:00Z').getUTCDay();

/** YYYY-MM-DD'ye n ay ekler; ayın gününü aşarsa ayın son gününe çeker (31 Oca + 1 ay = 28/29 Şub) */
export function addMonthsStr(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
/** Takvim günü farkı (b − a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

/**
 * Akış için hedef vadeler (artan). `zero` = bugünün 0DTE'si (yalnız işlem günüyse).
 * Bir vade listede olmayabilir (ör. bazı tickerlarda Cuma yok); eşleşme çağıranda yapılır.
 */
export function flowExpiries(nowMs: number, months = 3): FlowTarget[] {
  const today = etDate(nowMs);
  const out = new Map<string, FlowTarget>();
  if (isTradingDay(today)) out.set(today, { date: today, dte: 0, zero: true });
  const end = addMonthsStr(today, months);
  let f = today; while (dow(f) !== 5) f = addDaysStr(f, 1);
  for (; f <= end; f = addDaysStr(f, 7)) {
    const e = prevTradingDay(f);            // Cuma tatilse önceki işlem günü
    if (e < today || out.has(e)) continue;  // bugünden önce olanlar ve tekrarlar atlanır
    out.set(e, { date: e, dte: daysBetween(today, e), zero: false });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** MarketData `dte=` listesi: her hedef tek bir vadeye çözülür; tekrarsız, artan */
export function dteParam(targets: FlowTarget[]): string {
  return [...new Set(targets.map(t => t.dte))].sort((a, b) => a - b).join(',');
}
