/* Rapor veri kaynaklarının SAF ayrıştırıcıları (ağ yok). Yahoo chart JSON, SMA. Finnhub için news/finnhub.ts yeniden kullanılır. */

export interface ChartQuote { symbol: string; price: number | null; prevClose: number | null; prePrice: number | null; closes: number[]; time: number | null }

const finite = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Yahoo v8 chart yanıtı → fiyat, önceki kapanış, ön piyasa fiyatı, kapanış serisi. Hatalı/boş yanıt → null. */
export function parseYahooChart(j: any, symbol: string): ChartQuote | null {
  const r = j?.chart?.result?.[0];
  if (!r || !r.meta) return null;
  const m = r.meta;
  const closesRaw: unknown[] = r.indicators?.quote?.[0]?.close ?? [];
  const closes = closesRaw.filter((x): x is number => finite(x) != null);
  const price = finite(m.regularMarketPrice);
  const prevClose = finite(m.chartPreviousClose) ?? finite(m.previousClose);
  if (price == null && !closes.length) return null;
  return {
    symbol, price: price ?? closes[closes.length - 1] ?? null, prevClose, prePrice: finite(m.preMarketPrice), closes,
    time: finite(m.regularMarketTime) != null ? (m.regularMarketTime as number) * 1000 : null,
  };
}

/** Yüzde değişim (0,42 = %0,42). Veri yoksa null. */
export const pctOf = (price: number | null, prev: number | null): number | null =>
  price != null && prev != null && prev > 0 ? (price / prev - 1) * 100 : null;

/** Basit hareketli ortalama: son n kapanış. Yetersiz veri → null. */
export function sma(xs: number[], n: number): number | null {
  if (xs.length < n || n <= 0) return null;
  const s = xs.slice(-n).reduce((a, b) => a + b, 0);
  return +(s / n).toFixed(4);
}

/** Yahoo sembolü → URL parçası (^ ve = kaçışlı) */
export const yahooPath = (sym: string) => encodeURIComponent(sym);
