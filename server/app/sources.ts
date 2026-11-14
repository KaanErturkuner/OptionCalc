/*
 * Rapor kaynakları (sunucu): Yahoo chart (anahtarsız) ve Finnhub (anahtar YALNIZ başlıkta: X-Finnhub-Token; URL'de yok).
 * Yahoo'ya seri çağrı + aralık (nazik hız). Hata metinleri sırsızdır; URL ve anahtar asla hataya/loga girmez.
 */
import { parseYahooChart, parseYahooSeries, yahooPath, type ChartQuote, type SeriesQuote } from '../../src/lib/reports/sources.ts';
import { parseFinnhubEarnings, parseFinnhubNews } from '../../src/lib/news/finnhub.ts';
import type { NewsItem } from '../../src/lib/news/types.ts';

export type Fetch = typeof fetch;
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FINNHUB = 'https://finnhub.io/api/v1';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionCalcReports/1.0)' };

/** Ağ aralığı: çağrılar arasında en az gapMs (Yahoo ve Finnhub'a nazik davranış) */
export class Throttle {
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  private readonly gapMs: number;
  constructor(gapMs: number) { this.gapMs = gapMs; }
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(async () => {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.tail = p.catch(() => undefined);
    return p;
  }
}

export class YahooClient {
  private readonly th = new Throttle(350);
  private readonly f: Fetch;
  constructor(f: Fetch = fetch) { this.f = f; }
  /** range/interval: Yahoo sözdizimi (ör. '5d','1d'); pre: ön piyasa verisi dâhil */
  chart(sym: string, range: string, interval: string, pre = false): Promise<ChartQuote | null> {
    return this.th.run(async () => {
      const url = `${YAHOO}/${yahooPath(sym)}?range=${range}&interval=${interval}${pre ? '&includePrePost=true' : ''}`;
      const r = await this.f(url, { headers: UA, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
      return parseYahooChart(await r.json(), sym);
    });
  }
  /** Tarihsel seri (nokta-zamanlı yeniden kurulum): period1/period2 saniye; interval 1m|5m|1d. Yalnız backfill kullanır. */
  series(sym: string, period1: number, period2: number, interval: string, pre = false): Promise<SeriesQuote | null> {
    return this.th.run(async () => {
      const url = `${YAHOO}/${yahooPath(sym)}?period1=${period1}&period2=${period2}&interval=${interval}${pre ? '&includePrePost=true' : ''}`;
      const r = await this.f(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
      return parseYahooSeries(await r.json());
    });
  }
}

export class FinnhubClient {
  private readonly th = new Throttle(1100);   // ücretsiz plan: dakikada ~60 istek
  private readonly key: string;
  private readonly f: Fetch;
  constructor(key: string, f: Fetch = fetch) { this.key = key; this.f = f; }
  private async get(path: string): Promise<any> {
    return this.th.run(async () => {
      const r = await this.f(`${FINNHUB}${path}`, { headers: { 'X-Finnhub-Token': this.key, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);
      return r.json();
    });
  }
  /** Genel piyasa haberleri (son sinceMs) */
  async marketNews(sinceMs: number): Promise<NewsItem[]> {
    return parseFinnhubNews(await this.get('/news?category=general'), 'MARKET', sinceMs);
  }
  /** Şirket haberleri (sembol başına) */
  async companyNews(sym: string, sinceMs: number, today: string): Promise<NewsItem[]> {
    const from = new Date(sinceMs).toISOString().slice(0, 10);
    return parseFinnhubNews(await this.get(`/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${today}`), sym, sinceMs);
  }
  /** Bilanço takvimi (aralık, ham yanıt; doğrulama src/lib/earnings/model.ts'te). Anahtar başlıkta; hata metni sırsız. */
  calendarEarnings(from: string, to: string): Promise<unknown> {
    return this.get(`/calendar/earnings?from=${from}&to=${to}`);
  }
  /** Şirket profili (piyasa değeri: marketCapitalization, milyon USD). Ham yanıt; doğrulama src/lib/earnings/model.ts'te. */
  profile(sym: string): Promise<unknown> {
    return this.get(`/stock/profile2?symbol=${encodeURIComponent(sym)}`);
  }
  /** Geçmiş bilanço çeyrekleri (ham dizi; doğrulama parseFinnhubHistory). */
  earningsHistory(sym: string): Promise<unknown> {
    return this.get(`/stock/earnings?symbol=${encodeURIComponent(sym)}`);
  }
  /** Bilanço takvimi: tek istek, izleme listesi için satır satır (null = tarih yok) */
  async earnings(from: string, to: string, tickers: string[]): Promise<{ ticker: string; date: string | null }[]> {
    const j = await this.get(`/calendar/earnings?from=${from}&to=${to}`);
    return tickers.map(t => ({ ticker: t, date: parseFinnhubEarnings(j, t) }));
  }
}
