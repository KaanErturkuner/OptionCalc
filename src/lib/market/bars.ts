/* Gün içi 1 dk barlar: Yahoo v8 chart (anahtarsız, ~gerçek zamanlıya yakın), yedek MarketData candles */
import type { Bar } from '../odte/analytics.ts';
import { getJSON } from './types.ts';
import { mdCandles } from './marketdata.ts';
import { etDate } from '../usmarket.ts';
import type { DailyBar } from '../signals/qull/daily.ts';

export function parseYahooChart(j: any): Bar[] {
  const r = j?.chart?.result?.[0]; if (!r) return [];
  const ts: number[] = r.timestamp || [], q = r.indicators?.quote?.[0] || {};
  const out: Bar[] = [];
  ts.forEach((t, i) => {
    const c = q.close?.[i]; if (c == null) return;
    out.push({ t: t * 1000, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c, v: q.volume?.[i] ?? 0 });
  });
  return out;
}
export async function yahooBars(symbol: string, signal?: AbortSignal): Promise<Bar[]> {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`,
    { signal, headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: 15000 });
  return parseYahooChart(j);
}
/** Günlük barlar (Yahoo v8, 6 ay, anahtarsız). Bugünkü kısmi bar dâhil gelebilir: çağıran `D < bugün` ile süzer (sızıntı yok). */
export async function yahooDailyBars(symbol: string, signal?: AbortSignal): Promise<DailyBar[]> {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo&includePrePost=false`,
    { signal, headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: 15000 });
  return parseYahooChart(j).map(b => ({ D: etDate(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}
/**
 * Önce Yahoo (anahtarsız, kredisiz, gerçek zamanlıya yakın); olmazsa MarketData candles.
 * MarketData belgelerine göre candles uç noktası HİÇBİR planda gerçek zamanlı değil (UTP onayıyla 15 dk gecikmeli, yoksa 1 gün eski);
 * eskiden 20 dk tazelik eşiğiyle MarketData önce deneniyordu → Trader planında 15 dk gecikmeli barlar kabul edilip sinyaller bayatlıyordu
 * ve her taramada kredi harcanıyordu.
 */
export async function loadBars(symbol: string, mdKey?: string, signal?: AbortSignal, now = Date.now()): Promise<{ bars: Bar[]; source: string; credits: number }> {
  let yErr: unknown = null;
  try { const b = await yahooBars(symbol, signal); if (b.length) return { bars: b, source: 'Yahoo', credits: 0 }; } catch (e) { yErr = e; }
  if (mdKey) {
    const { bars: b, credits } = await mdCandles(symbol, mdKey, etDate(now), signal);
    if (b.length) return { bars: b, source: now - b[b.length - 1].t > 5 * 60000 ? 'MarketData (gecikmeli)' : 'MarketData', credits };
  }
  if (yErr) throw yErr;
  return { bars: [], source: 'Yahoo', credits: 0 };
}
