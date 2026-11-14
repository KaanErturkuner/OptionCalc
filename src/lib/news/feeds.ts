/*
 * Haber kaynakları (anahtarsız RSS). Ayrıştırma saf; ağ çağrıları fetch ile.
 * Kaynaklar: Yahoo Finance (hisse başına), Google News (sorgu başına; birden çok kaynak), CNBC (piyasa üst haberleri).
 * Her kaynak ayrı çağrıdır; biri düşerse diğerleri sürer (Promise.allSettled). Kaynak ismi item'ın <source> alanından gelir.
 */
import { parseYahooRss, hash } from './yahoo.ts';
import type { NewsItem } from './types.ts';

export interface FeedSpec { id: string; url: string; label: string }

/** Yahoo: sembol listesi tek istekte */
export function yahooFeed(symbols: string[]): FeedSpec {
  return { id: 'yahoo', label: 'Yahoo Finance', url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbols.join(','))}&region=US&lang=en-US` };
}
/** Google News: sorgu (ör. "MU OR AMD stock"); en fazla 4 sembol/sorgu ile sonuç çeşitliliği iyi kalır */
export function googleFeed(query: string): FeedSpec {
  return { id: 'google', label: 'Google News', url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en` };
}
/** CNBC üst haberler (piyasa geneli) */
export const CNBC_TOP: FeedSpec = { id: 'cnbc', label: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' };

/** Sembol listesini Google sorgularına böler: 4'erli gruplar, "X OR Y OR Z stock" */
export function googleQueries(symbols: string[], group = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < symbols.length; i += group) out.push(`${symbols.slice(i, i + group).join(' OR ')} stock`);
  return out;
}

/** Tüm kaynakların listesi (haber toplama turu için) */
export function feedsFor(symbols: string[]): FeedSpec[] {
  return [yahooFeed(symbols), ...googleQueries(symbols).map(googleFeed), CNBC_TOP];
}

/** Başlığı karşılaştırma için normalize et (tekrar elemesi): küçük harf, noktalama ve boşluk yok */
/** Google başlıkları " - Kaynak" ekini taşır; tekrar elemesinde bu ek yok sayılır */
export const titleKey = (t: string) => t.replace(/\s[-|–]\s[^-|–]{2,40}$/, '').toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, ' ').trim().slice(0, 90);

/** Birden çok kaynaktan gelen haberleri birleştirir: URL veya başlık benzerliğiyle tekrarları eler; yeniden eskiye sıralar. */
export function mergeNews(lists: NewsItem[][]): NewsItem[] {
  const seenUrl = new Set<string>(), seenTitle = new Set<string>(), out: NewsItem[] = [];
  for (const n of lists.flat().sort((a, b) => b.publishedAt - a.publishedAt)) {
    const tk = titleKey(n.title);
    if (seenUrl.has(n.url) || seenTitle.has(tk)) continue;
    seenUrl.add(n.url); seenTitle.add(tk); out.push(n);
  }
  return out;
}

/** Ağ: tek RSS kaynağını çeker ve ayrıştırır (hata olursa boş liste; üst katman kaynak hatasını raporlar) */
export async function fetchFeed(spec: FeedSpec, universe: string[], sinceMs: number, signal?: AbortSignal): Promise<NewsItem[]> {
  const r = await fetch(spec.url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${spec.label} HTTP ${r.status}`);
  const items = parseYahooRss(await r.text(), universe, sinceMs);
  return items.map(n => ({ ...n, id: n.url || hash(n.title), source: n.source || spec.label }));
}

/** Tüm kaynakları paralel çeker; başarılı olanları birleştirir. Dönüş: haberler + kaynak başına durum. */
export async function fetchAllNews(symbols: string[], universe: string[], sinceMs: number, signal?: AbortSignal):
  Promise<{ items: NewsItem[]; status: { id: string; label: string; ok: boolean; count: number; error?: string }[] }> {
  const specs = feedsFor(symbols);
  const settled = await Promise.allSettled(specs.map(s => fetchFeed(s, universe, sinceMs, signal)));
  const status = settled.map((r, i) => ({
    id: specs[i].id, label: specs[i].label, ok: r.status === 'fulfilled', count: r.status === 'fulfilled' ? r.value.length : 0,
    error: r.status === 'rejected' ? String((r.reason as Error)?.message ?? 'hata') : undefined,
  }));
  const lists = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
  return { items: mergeNews(lists), status };
}
