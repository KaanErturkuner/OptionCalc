/* Haber toplayıcı: tek Yahoo isteği / 5 dk (tüm liste), SEC ve Finnhub isteğe bağlı; seen kümesiyle tekrar elenir. */
import { fetchYahooNews } from './yahoo.ts';
import { fetchSecCik, fetchSecFilings } from './sec.ts';
import { fetchFinnhubNews } from './finnhub.ts';
import type { NewsItem } from './types.ts';
import { registerSecret, reportFail, reportOk } from '../freshness.ts';
export type { NewsItem, NewsKind } from './types.ts';
export { classify } from './classify.ts';
export { tickersIn, NAMES } from './names.ts';

export interface NewsSettings { secUa?: string; finnhubKey?: string }
export const POLL_GAP_MS = 5 * 60000;
export const RELATED_WINDOW_MS = 6 * 3600000;

export class NewsHub {
  private seen = new Set<string>();
  private lastPoll = -Infinity;
  private cik = new Map<string, string | null>();
  /** Yeni (daha önce görülmemiş) haberler. 5 dk'dan sık çağrılırsa boş döner. */
  async poll(tickers: string[], universe: string[], sinceMs: number, s: NewsSettings, now = Date.now(), signal?: AbortSignal): Promise<NewsItem[]> {
    if (now - this.lastPoll < POLL_GAP_MS) return [];
    this.lastPoll = now;
    const all: NewsItem[] = [];
    registerSecret(s.finnhubKey); registerSecret(s.secUa);
    // Kaynak etiketleri (tazelik göstergesi için): yahoo / sec / finnhub
    const jobs: { p: string; run: Promise<NewsItem[]> }[] = [{ p: 'yahoo', run: fetchYahooNews(tickers, universe, sinceMs, signal) }];
    if (s.secUa) for (const t of tickers) jobs.push({ p: 'sec', run: (async () => {
      if (!this.cik.has(t)) this.cik.set(t, await fetchSecCik(t, s.secUa!, signal));
      const c = this.cik.get(t); return c ? fetchSecFilings(t, c, s.secUa!, sinceMs, signal) : [];
    })() });
    if (s.finnhubKey) for (const t of tickers) jobs.push({ p: 'finnhub', run: fetchFinnhubNews(t, s.finnhubKey!, new Date(sinceMs).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10), signal) });
    const settled = await Promise.allSettled(jobs.map(j => j.run));
    let okP: string | undefined, errP: string | undefined, errV: unknown;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') { all.push(...r.value); okP = okP ?? jobs[i].p; }
      else { errP = errP ?? jobs[i].p; errV = errV ?? r.reason; }
    });
    // Tek tek hata yalnız tamamı başarısızsa "hata" sayılır; kısmi başarı = güncel
    if (okP) reportOk('news', { provider: okP, at: now });
    else if (errP && !signal?.aborted) reportFail('news', errV, { provider: errP, at: now });
    const fresh: NewsItem[] = [];
    for (const n of all) { const k = n.url || n.id; if (this.seen.has(k)) continue; this.seen.add(k); fresh.push(n); }
    return fresh.sort((a, b) => b.publishedAt - a.publishedAt);
  }
}
/** Sinyal anından ±6 saat içindeki aynı ticker haberleri */
export function relatedNews(items: NewsItem[], ticker: string, at: number, windowMs = RELATED_WINDOW_MS): NewsItem[] {
  return items.filter(n => n.tickers.includes(ticker) && Math.abs(n.publishedAt - at) <= windowMs);
}
