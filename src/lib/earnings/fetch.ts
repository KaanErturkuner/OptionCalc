/*
 * Bilanço takvimi ağ katmanı (anahtarsız). Gün başına bir istek; bellekte önbellek (aynı gün tekrar istenmez).
 * Kaynak: Nasdaq halka açık takvim uç noktası. Resmî API değildir; yanıt biçimi değişebilir → ayrıştırma savunmacıdır.
 */
import { parseEarningsCalendar, type EarningsRow } from './calendar.ts';

const cache = new Map<string, EarningsRow[]>();

export async function fetchEarningsDay(date: string, signal?: AbortSignal): Promise<EarningsRow[]> {
  const hit = cache.get(date);
  if (hit) return hit;
  const r = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
    signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Bilanço takvimi HTTP ${r.status}`);
  const rows = parseEarningsCalendar(await r.json());
  cache.set(date, rows);
  return rows;
}
