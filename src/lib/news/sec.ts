/* SEC EDGAR: 8-K (olay) ve Form 4 (içeriden işlem). User-Agent zorunlu (iletişim e-postası ayarlardan girilir). */

import type { NewsItem } from './types.ts';

const WANT = /^(8-K|8-K\/A|4|4\/A)$/;
/** company_tickers.json → ticker → CIK (10 hane) */
export function cikFor(j: any, ticker: string): string | null {
  const row = Object.values(j ?? {}).find((r: any) => String(r?.ticker).toUpperCase() === ticker.toUpperCase()) as any;
  return row ? String(row.cik_str).padStart(10, '0') : null;
}
/** submissions JSON → son filings (sinceMs sonrası, 8-K ve Form 4) */
export function parseSecSubmissions(j: any, ticker: string, sinceMs = 0): NewsItem[] {
  const rec = j?.filings?.recent; if (!rec?.form) return [];
  const cik = String(parseInt(String(j.cik), 10));
  const out: NewsItem[] = [];
  rec.form.forEach((form: string, i: number) => {
    if (!WANT.test(form)) return;
    const publishedAt = Date.parse(rec.filingDate[i] + 'T12:00:00Z');
    if (!isFinite(publishedAt) || publishedAt < sinceMs) return;
    const acc = String(rec.accessionNumber[i]).replace(/-/g, ''), doc = rec.primaryDocument[i];
    const insider = form.startsWith('4');
    const title = insider ? `${ticker} içeriden işlem bildirimi (Form ${form})` : `${ticker} olay bildirimi (8-K)`;
    out.push({ id: `${acc}`, tickers: [ticker], title, source: 'SEC EDGAR', url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${doc}`,
      publishedAt, kind: insider ? 'insider' : 'filing', tags: insider ? ['insider'] : ['8-K'] });
  });
  return out;
}
export async function fetchSecFilings(ticker: string, cik: string, ua: string, sinceMs: number, signal?: AbortSignal): Promise<NewsItem[]> {
  if (!ua.trim()) return [];
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { signal, headers: { 'User-Agent': ua } });
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`);
  return parseSecSubmissions(await r.json(), ticker, sinceMs);
}
export async function fetchSecCik(ticker: string, ua: string, signal?: AbortSignal): Promise<string | null> {
  if (!ua.trim()) return null;
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', { signal, headers: { 'User-Agent': ua } });
  if (!r.ok) return null;
  return cikFor(await r.json(), ticker);
}
