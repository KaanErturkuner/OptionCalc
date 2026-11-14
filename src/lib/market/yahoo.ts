/* Yahoo Finance (anahtarsız, cookie + crumb): fiyat, temettü verimi, vade bazlı zincir */
import { HttpError, getJSON, num, type Chain, type OptQuote, type Provider, type Quote } from './types.ts';

const Q = 'https://query2.finance.yahoo.com';
let crumb: string | null = null, cookie = '';
const UA = { 'User-Agent': 'Mozilla/5.0' }; // tam tarayıcı UA'sı Yahoo'da 429 alıyor
const hdrs = () => ({ ...UA, ...(cookie ? { Cookie: cookie } : {}) });
async function getCrumb(force = false, signal?: AbortSignal): Promise<string> {
  if (crumb && !force) return crumb;
  try { // A3 çerezi; iOS/Android fetch çerezi kendisi saklar, Node'da başlıktan alırız
    const r = await fetch('https://fc.yahoo.com', { signal, credentials: 'include' as RequestCredentials, headers: UA });
    const sc = r.headers.get('set-cookie'); const m = sc && /A3=[^;]+/.exec(sc); if (m) cookie = m[0];
  } catch {}
  const r = await fetch(`${Q}/v1/test/getcrumb`, { signal, credentials: 'include' as RequestCredentials, headers: hdrs() });
  const t = (await r.text()).trim();
  if (!r.ok || !t || t.length > 40 || t.includes('<')) throw new Error('Yahoo erişimi reddetti');
  crumb = t; return t;
}
async function yget(path: string, signal?: AbortSignal): Promise<any> {
  for (let i = 0; i < 2; i++) {
    const c = await getCrumb(i > 0, signal);
    try {
      return await getJSON(`${Q}${path}${path.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(c)}`,
        { signal, credentials: 'include' as RequestCredentials, headers: hdrs() });
    } catch (e) { if (!(e instanceof HttpError && (e.status === 401 || e.status === 403)) || i) throw e; }
  }
}
const isoDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export function parseYahooQuote(q: any): Quote {
  if (!q || !(num(q.regularMarketPrice) > 0)) throw new Error('Sembol bulunamadı');
  // Seans dışında (PRE/POST) uzatılmış seans fiyatını göster ama opsiyon değerlemesi için normal seans daha tutarlı
  const price = num(q.regularMarketPrice), dr = num(q.dividendRate) || num(q.trailingAnnualDividendRate);
  return {
    symbol: String(q.symbol), name: q.longName || q.shortName, price, change: num(q.regularMarketChange), changePct: num(q.regularMarketChangePercent),
    prevClose: num(q.regularMarketPreviousClose) || undefined, bid: num(q.bid) || undefined, ask: num(q.ask) || undefined,
    extPrice: num(q.postMarketPrice) || num(q.preMarketPrice) || undefined,
    time: num(q.regularMarketTime) * 1000, delayedMin: num(q.exchangeDataDelayedBy),
    divRate: dr || undefined, divYield: dr > 0 ? dr / price * 100 : (num(q.trailingAnnualDividendYield) * 100 || undefined), source: 'Yahoo',
  };
}
function yOpt(x: any, type: 'call' | 'put'): OptQuote {
  const iv = num(x.impliedVolatility);
  return { type, strike: num(x.strike), bid: num(x.bid), ask: num(x.ask), last: num(x.lastPrice),
    iv: iv > 0.005 && iv < 10 && (num(x.bid) > 0 || num(x.ask) > 0) ? iv : null, volume: num(x.volume), oi: num(x.openInterest) };
}
export function parseYahooOptions(j: any): { quote: Quote; expirations: string[]; chain: Chain | null } {
  const r = j?.optionChain?.result?.[0]; if (!r) throw new Error('Sembol bulunamadı');
  const o = r.options?.[0];
  const chain = o ? { expiry: isoDay(num(o.expirationDate)), calls: (o.calls || []).map((x: any) => yOpt(x, 'call')), puts: (o.puts || []).map((x: any) => yOpt(x, 'put')) } : null;
  return { quote: parseYahooQuote(r.quote), expirations: (r.expirationDates || []).map((u: number) => isoDay(u)), chain };
}

const cache = new Map<string, { t: number; v: any }>();
const TTL = 60000;
async function cached<T>(k: string, f: () => Promise<T>): Promise<T> {
  const h = cache.get(k); if (h && Date.now() - h.t < TTL) return h.v;
  const v = await f(); cache.set(k, { t: Date.now(), v }); return v;
}
export const yahoo: Provider = {
  id: 'yahoo', name: 'Yahoo Finance (anahtarsız)', delayedMin: 15, needsKey: false,
  async load(symbol, o) {
    const v = await cached('o:' + symbol, async () => parseYahooOptions(await yget(`/v7/finance/options/${encodeURIComponent(symbol)}`, o?.signal)));
    if (v.chain) cache.set(`c:${symbol}:${v.chain.expiry}`, { t: Date.now(), v: v.chain });
    if (!v.expirations.length) throw new Error('Opsiyon zinciri boş');
    return { quote: v.quote, expirations: v.expirations };
  },
  async chain(symbol, expiry, o) {
    return cached(`c:${symbol}:${expiry}`, async () => {
      const unix = Date.parse(expiry + 'T00:00:00Z') / 1000;
      const v = parseYahooOptions(await yget(`/v7/finance/options/${encodeURIComponent(symbol)}?date=${unix}`, o?.signal));
      if (!v.chain) throw new Error('Bu vade için veri yok');
      if (v.chain.expiry !== expiry) throw new Error('Yahoo istenen vade yerine başka vade döndürdü'); // yanlış vade önbelleğe girmez
      return v.chain;
    });
  },
};
/** Sadece temettü/isim bilgisi (CBOE'yi tamamlamak için, hata olursa sessiz) */
export async function yahooQuoteExtras(symbol: string): Promise<Quote | null> {
  try { return (await yahoo.load(symbol)).quote; } catch { return null; }
}
export const clearYahooCache = () => cache.clear();
