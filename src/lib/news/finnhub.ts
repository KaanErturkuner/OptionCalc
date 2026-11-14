/* Finnhub (isteğe bağlı anahtar): şirket haberleri ve bilanço takvimi. Ayrıştırma saf. */
import { classify } from './classify.ts';
import type { NewsItem } from './types.ts';
import { hash } from './yahoo.ts';

export function parseFinnhubNews(j: any[], ticker: string, sinceMs = 0): NewsItem[] {
  return (Array.isArray(j) ? j : []).flatMap((n: any) => {
    const publishedAt = Number(n.datetime) * 1000;
    if (!n.headline || !isFinite(publishedAt) || publishedAt < sinceMs) return [];
    const c = classify(`${n.headline} ${n.summary ?? ''}`);
    return [{ id: String(n.id ?? hash(n.url ?? n.headline)), tickers: [ticker], title: n.headline, source: n.source || 'Finnhub',
      url: n.url || '', publishedAt, kind: 'news' as const, sentiment: c.sentiment, tags: c.tags }];
  });
}
/** Bilanço takvimi → ilk gelecek/yakın tarih (YYYY-MM-DD) */
export function parseFinnhubEarnings(j: any, ticker: string): string | null {
  const rows: any[] = j?.earningsCalendar ?? [];
  const row = rows.filter(r => r.symbol === ticker && r.date).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  return row?.date ?? null;
}
export async function fetchFinnhubNews(ticker: string, key: string, from: string, to: string, signal?: AbortSignal): Promise<NewsItem[]> {
  const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`, { signal });
  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);
  return parseFinnhubNews(await r.json(), ticker, Date.parse(from + 'T00:00:00Z'));
}
export async function fetchFinnhubEarnings(ticker: string, key: string, from: string, to: string, signal?: AbortSignal): Promise<string | null> {
  const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`, { signal });
  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);   // hata ≠ "bilanço yok": çağıran bilinmiyor sayar
  return parseFinnhubEarnings(await r.json(), ticker);
}
