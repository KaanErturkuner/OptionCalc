/*
 * Korku ve Açgözlülük girdileri: günlük kapanışlar (Yahoo, anahtarsız). Bugünkü kısmi bar dışarıda tutulur (sızıntı yok).
 */
import { yahooDailyBars } from '../market/bars.ts';
import { etDate } from '../usmarket.ts';
import { buildComponents, composite, type FngResult } from './fng.ts';

export interface SentimentSnapshot { result: FngResult; asOf: string | null }

export async function fetchSentiment(nowMs = Date.now()): Promise<SentimentSnapshot> {
  const today = etDate(nowMs);
  const syms = ['^VIX', 'SPY', 'TLT', 'HYG', 'LQD'] as const;
  const series = await Promise.all(syms.map(s => yahooDailyBars(s)));
  const closes = series.map(bars => bars.filter(b => b.D < today).map(b => b.c));
  const [vix, spy, tlt, hyg, lqd] = closes;
  const asOf = series[1].filter(b => b.D < today).at(-1)?.D ?? null;
  return { result: composite(buildComponents({ vix, spy, tlt, hyg, lqd })), asOf };
}
