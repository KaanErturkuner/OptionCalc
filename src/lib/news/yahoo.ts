/* Yahoo Finance RSS (anahtarsız). Ayrıştırma saf; ağ çağrısı fetchYahooNews. */
import { classify } from './classify.ts';
import { tickersIn } from './names.ts';
import type { NewsItem } from './types.ts';

const decode = (s: string) => s.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (x: string, name: string) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(x); return m ? decode(m[1]) : ''; };
export const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** RSS XML → NewsItem[] (sinceMs'den yeni olanlar; evren tickerlarına göre etiketlenir) */
export function parseYahooRss(xml: string, universe: string[], sinceMs = 0): NewsItem[] {
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1], title = tag(x, 'title'), url = tag(x, 'link'), desc = tag(x, 'description');
    const publishedAt = Date.parse(tag(x, 'pubDate'));
    if (!title || !isFinite(publishedAt) || publishedAt < sinceMs) continue;
    const tickers = tickersIn(`${title} ${desc}`, universe);
    const c = classify(title);
    out.push({ id: url || hash(title), tickers, title, source: tag(x, 'source') || 'Yahoo Finance', url, publishedAt, kind: 'news', sentiment: c.sentiment, tags: c.tags });
  }
  return out;
}
export async function fetchYahooNews(symbols: string[], universe: string[], sinceMs: number, signal?: AbortSignal): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbols.join(','))}&region=US&lang=en-US`;
  const r = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo haber HTTP ${r.status}`);
  return parseYahooRss(await r.text(), universe, sinceMs);
}
