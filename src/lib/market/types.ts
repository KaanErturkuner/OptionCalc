/* Piyasa verisi: sağlayıcıdan bağımsız tipler */
export interface Quote {
  symbol: string; name?: string;
  price: number; change: number; changePct: number; prevClose?: number;
  bid?: number; ask?: number;
  extPrice?: number;         // seans dışı (pre/after/overnight) son fiyat
  time: number;              // son işlem anı (UTC ms)
  delayedMin: number;        // 0 = gerçek zamanlı
  divYield?: number;         // yıllık temettü verimi, yüzde (0,3 = %0,3)
  divRate?: number;          // yıllık temettü $/hisse
  iv30?: number;             // yüzde
  credits?: number;          // bu istekte harcanan API kredisi (MarketData)
  source: string;
}
export interface OptQuote {
  type: 'call' | 'put'; strike: number;
  bid: number; ask: number; last: number;
  iv: number | null;         // ondalık (0,25), sağlayıcının hesapladığı
  volume: number; oi: number; delta?: number; gamma?: number;
}
export interface Chain { expiry: string; calls: OptQuote[]; puts: OptQuote[]; updated?: number; underlying?: number; credits?: number }
export interface Provider {
  id: ProviderId; name: string; delayedMin: number; needsKey: boolean;
  /** Fiyat + mevcut vadeler (YYYY-MM-DD, artan) */
  load(symbol: string, opts?: ProvOpts): Promise<{ quote: Quote; expirations: string[] }>;
  chain(symbol: string, expiry: string, opts?: ProvOpts): Promise<Chain>;
}
export interface ProvOpts {
  key?: string; signal?: AbortSignal; strikeLimit?: number; center?: number;
  /** Yalnızca MarketData: 'cached' → zincir isteği sembol sayısından bağımsız 1 kredi (veri birkaç sn–dk eski olabilir); maxAge ör. '2min' */
  mdMode?: 'live' | 'cached'; mdMaxAge?: string;
}
export type ProviderId = 'cboe' | 'yahoo' | 'tradier' | 'marketdata';

export const mid = (o: OptQuote) => o.bid > 0 && o.ask > 0 && o.ask >= o.bid ? (o.bid + o.ask) / 2 : o.last > 0 ? o.last : 0;   // alıcı yoksa orta uydurulmaz (sahte stop önlenir)
export const spreadPct = (o: OptQuote) => o.bid > 0 && o.ask > 0 ? (o.ask - o.bid) / ((o.ask + o.bid) / 2) : Infinity;
export const num = (x: unknown): number => { const n = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN; return isFinite(n) ? n : 0; };
/** OCC sembolü: KÖK + YYMMDD + C/P + strike×1000 (8 hane) */
export function parseOcc(s: string): { root: string; expiry: string; type: 'call' | 'put'; strike: number } | null {
  const m = /^([A-Z0-9.]+?)(\d{6})([CP])(\d{8})$/.exec(s.replace(/\s+/g, ''));
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`, type: m[3] === 'C' ? 'call' : 'put', strike: +m[4] / 1000 };
}
/** Ağ isteği: zaman aşımı + JSON; hata mesajı Türkçe */
export async function getJSON(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 15000);
  const outer = init.signal; if (outer) outer.addEventListener('abort', () => ctl.abort());
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new HttpError(r.status, `HTTP ${r.status}`);
    return await r.json();
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    if (e?.name === 'AbortError') throw new Error('Zaman aşımı');
    throw new Error('Bağlantı yok');
  } finally { clearTimeout(t); }
}
export class HttpError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }
