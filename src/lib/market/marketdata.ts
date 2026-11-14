/*
 * MarketData.app — uygulama artık DOĞRUDAN çağırmaz: sunucu proxy'si (server/, docs/tasks/FLOW.md) üzerinden.
 * Yollar ve yanıt biçimi MarketData'nınkiyle aynı (proxy şeffaf iletir); anahtar = Akış sunucu anahtarı (x-app-key).
 * MarketData tokenı yalnız sunucudadır (tek IP kuralı: aynı token iki IP'den kullanılırsa hesap 5 dk bloklanır).
 * Kredi: hisse kotu 1, zincir kontrat başına 1 (live) / istek başına 1 (cached), vade listesi 1, mum 1000 mum başına 1.
 */
import { closeMs, etDate, isTradingDay, addDaysStr, marketOpen } from '../usmarket.ts';
import { HttpError, num, type Chain, type OptQuote, type Provider, type ProvOpts, type Quote } from './types.ts';
import { FLOW_BASE_URL } from '../flow/model.ts';
import { APP_KEY_HEADER, MD_PROXY_PREFIX } from '../flow/proxy.ts';

const BASE = FLOW_BASE_URL.replace(/\/+$/, '') + MD_PROXY_PREFIX;
export interface MdResp { json: any; credits: number; remaining: number | null; status: number }
let lastCredits = { consumed: 0, remaining: null as number | null };
export const mdCredits = () => lastCredits;

export async function mdGet(path: string, key: string | undefined, signal?: AbortSignal, timeoutMs = 20000): Promise<MdResp> {
  if (!key) throw new Error('Sunucu anahtarı gerekli (Hesapla › Ayarlar)');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctl.abort());
  let r: Response;
  try { r = await fetch(BASE + path, { headers: { [APP_KEY_HEADER]: key, Accept: 'application/json' }, signal: ctl.signal }); }
  catch (e: any) { throw new Error(e?.name === 'AbortError' ? 'Zaman aşımı' : 'Bağlantı yok'); }
  finally { clearTimeout(t); }
  const credits = num(r.headers.get('x-api-ratelimit-consumed')), remH = r.headers.get('x-api-ratelimit-remaining');
  const remaining = remH != null ? num(remH) : null;
  lastCredits = { consumed: credits, remaining };
  if (r.status === 204) return { json: { s: 'no_data' }, credits, remaining, status: 204 };
  let json: any = null; try { json = await r.json(); } catch {}
  if (!r.ok) throw new HttpError(r.status, mdError(r.status, json));
  if (json?.s === 'error') throw new HttpError(r.status, mdError(r.status, json));
  return { json, credits, remaining, status: r.status };
}
export function mdError(status: number, j: any): string {
  const m = String(j?.errmsg || '');
  if (/one device/i.test(m)) return 'MarketData: tek cihaz kuralı — token başka bir cihaz/IP’den de kullanılıyor; 5 dk bekleyip tek cihazdan dene';
  if (status === 401) return 'Sunucu (MarketData proxy): anahtar geçersiz';
  if (status === 402) return 'MarketData: bu veri planında yok (402)';
  if (status === 429) return 'MarketData: günlük kredi bitti (ABD açılışında, TR 16:30–17:30 arası yenilenir)';
  if (status === 404) return 'Sembol bulunamadı';
  return 'MarketData: ' + (m || `HTTP ${status}`);
}
const col = (j: any, k: string, i: number) => Array.isArray(j?.[k]) ? j[k][i] : undefined;

export function parseMdQuote(j: any, symbol: string): Quote {
  if (j?.s === 'no_data' || !Array.isArray(j?.symbol)) throw new Error('Sembol bulunamadı');
  const last = num(col(j, 'last', 0)), m = num(col(j, 'mid', 0));
  const price = last || m; if (!(price > 0)) throw new Error('Sembol bulunamadı');
  return { symbol, price, change: num(col(j, 'change', 0)), changePct: num(col(j, 'changepct', 0)) * 100,
    bid: num(col(j, 'bid', 0)) || undefined, ask: num(col(j, 'ask', 0)) || undefined,
    time: num(col(j, 'updated', 0)) * 1000, delayedMin: 0, source: 'MarketData' };
}
export function parseMdExpirations(j: any): string[] {
  return (Array.isArray(j?.expirations) ? j.expirations : []).map((e: any) => typeof e === 'number' ? new Date(e * 1000).toISOString().slice(0, 10) : String(e).slice(0, 10)).sort();
}
export function parseMdChain(j: any, expiry: string): Chain {
  const c: Chain = { expiry, calls: [], puts: [] };
  const n = Array.isArray(j?.optionSymbol) ? j.optionSymbol.length : 0;
  let upd = 0, und = 0;
  for (let i = 0; i < n; i++) {
    const side = col(j, 'side', i) === 'put' ? 'put' : 'call', iv = num(col(j, 'iv', i));
    const q: OptQuote = { type: side, strike: num(col(j, 'strike', i)), bid: num(col(j, 'bid', i)), ask: num(col(j, 'ask', i)), last: num(col(j, 'last', i)),
      iv: iv > 0.005 && iv < 10 ? iv : null, volume: num(col(j, 'volume', i)), oi: num(col(j, 'openInterest', i)),
      delta: col(j, 'delta', i) == null ? undefined : num(col(j, 'delta', i)), gamma: col(j, 'gamma', i) == null ? undefined : num(col(j, 'gamma', i)) };
    (side === 'call' ? c.calls : c.puts).push(q);
    upd = Math.max(upd, num(col(j, 'updated', i))); und = und || num(col(j, 'underlyingPrice', i));
  }
  c.calls.sort((a, b) => a.strike - b.strike); c.puts.sort((a, b) => a.strike - b.strike);
  c.updated = upd ? upd * 1000 : undefined; c.underlying = und || undefined;
  return c;
}
/** 1 dk mumlar: {t,o,h,l,c,v} */
export function parseMdCandles(j: any): { t: number; o: number; h: number; l: number; c: number; v: number }[] {
  const n = Array.isArray(j?.t) ? j.t.length : 0, out = [];
  for (let i = 0; i < n; i++) out.push({ t: num(j.t[i]) * 1000, o: num(j.o[i]), h: num(j.h[i]), l: num(j.l[i]), c: num(j.c[i]), v: num(j.v?.[i]) });
  return out;
}

/** Son tamamlanmış (veya süren) seansın kapanışı; tazelik kontrolü için */
export function lastSessionClose(now: number): number {
  let d = etDate(now);
  if (isTradingDay(d) && now >= closeMs(d)) return closeMs(d);
  do { d = addDaysStr(d, -1); } while (!isTradingDay(d));
  return closeMs(d);
}
/**
 * Veri bayat mı? Seans açıkken 20 dk'dan eski ise; kapalıyken son seans kapanışından (−5 dk) eski ise.
 * MarketData deneme planı seans içinde önceki günü döndürür → bayat.
 */
export function isStale(updatedMs: number | undefined, now: number): boolean {
  if (!updatedMs || !isFinite(updatedMs)) return true;
  if (marketOpen(now)) return now - updatedMs > 20 * 60000;
  return updatedMs < lastSessionClose(now) - 5 * 60000;
}

const cache = new Map<string, { t: number; v: any }>();
const TTL = 30000;
async function cached<T>(k: string, f: () => Promise<T>): Promise<T> {
  const h = cache.get(k); if (h && Date.now() - h.t < TTL) return h.v;
  const v = await f(); cache.set(k, { t: Date.now(), v }); return v;
}
export const clearMdCache = () => cache.clear();

export const marketdata: Provider = {
  id: 'marketdata', name: 'Sunucu (MarketData)', delayedMin: 0, needsKey: true,
  async load(symbol, o) {
    return cached(`l:${symbol}`, async () => {
      const [q, e] = await Promise.all([mdGet(`/stocks/quotes/${encodeURIComponent(symbol)}/`, o?.key, o?.signal),
        mdGet(`/options/expirations/${encodeURIComponent(symbol)}/`, o?.key, o?.signal)]);
      const quote = parseMdQuote(q.json, symbol); quote.credits = q.credits + e.credits;
      const age = Date.now() - quote.time; quote.delayedMin = marketOpen() ? Math.max(0, Math.round(age / 60000)) : 0;
      return { quote, expirations: parseMdExpirations(e.json) };
    });
  },
  async chain(symbol, expiry, o?: ProvOpts) {
    const lim = o?.strikeLimit ?? 30, mode = o?.mdMode === 'cached' ? `&mode=cached&maxage=${encodeURIComponent(o.mdMaxAge || '2min')}` : '';
    return cached(`c:${symbol}:${expiry}:${lim}${mode}`, async () => {
      const r = await mdGet(`/options/chain/${encodeURIComponent(symbol)}/?expiration=${expiry}&strikeLimit=${lim}${mode}`, o?.key, o?.signal);
      const c = parseMdChain(r.json, expiry); c.credits = r.credits; return c;
    });
  },
};
export async function mdCandles(symbol: string, key: string, day: string, signal?: AbortSignal) {
  const r = await mdGet(`/stocks/candles/1/${encodeURIComponent(symbol)}/?from=${day}&to=${addDaysStr(day, 1)}`, key, signal);
  return { bars: parseMdCandles(r.json), credits: r.credits };
}
