/* Tradier (kullanıcı API anahtarı; brokerage hesabında gerçek zamanlı) — isteğe bağlı */
import { getJSON, num, type Chain, type OptQuote, type Provider, type Quote } from './types.ts';

const BASE = 'https://api.tradier.com/v1';
const arr = (x: any) => x == null ? [] : Array.isArray(x) ? x : [x];
const hdr = (key?: string) => { if (!key) throw new Error('Tradier API anahtarı gerekli'); return { Authorization: `Bearer ${key}`, Accept: 'application/json' }; };

export function parseTradierQuote(j: any): Quote {
  const q = arr(j?.quotes?.quote)[0]; if (!q || !(num(q.last) > 0 || num(q.prevclose) > 0)) throw new Error('Sembol bulunamadı');
  return { symbol: q.symbol, name: q.description, price: num(q.last) || num(q.prevclose), change: num(q.change), changePct: num(q.change_percentage),
    prevClose: num(q.prevclose) || undefined, bid: num(q.bid) || undefined, ask: num(q.ask) || undefined,
    time: num(q.trade_date) || Date.now(), delayedMin: 0, source: 'Tradier' };
}
export function parseTradierChain(j: any, expiry: string): Chain {
  const c: Chain = { expiry, calls: [], puts: [] };
  for (const o of arr(j?.options?.option)) {
    const type = o.option_type === 'put' ? 'put' : 'call', iv = num(o.greeks?.mid_iv) || num(o.greeks?.smv_vol);
    const q: OptQuote = { type, strike: num(o.strike), bid: num(o.bid), ask: num(o.ask), last: num(o.last),
      iv: iv > 0.005 && iv < 10 ? iv : null, volume: num(o.volume), oi: num(o.open_interest), delta: o.greeks ? num(o.greeks.delta) : undefined };
    (type === 'call' ? c.calls : c.puts).push(q);
  }
  c.calls.sort((a, b) => a.strike - b.strike); c.puts.sort((a, b) => a.strike - b.strike);
  return c;
}
export const tradier: Provider = {
  id: 'tradier', name: 'Tradier (API anahtarı)', delayedMin: 0, needsKey: true,
  async load(symbol, o) {
    const h = hdr(o?.key);
    const [qj, ej] = await Promise.all([
      getJSON(`${BASE}/markets/quotes?symbols=${encodeURIComponent(symbol)}`, { headers: h, signal: o?.signal }),
      getJSON(`${BASE}/markets/options/expirations?symbol=${encodeURIComponent(symbol)}`, { headers: h, signal: o?.signal }),
    ]);
    return { quote: parseTradierQuote(qj), expirations: arr(ej?.expirations?.date).map(String) };
  },
  async chain(symbol, expiry, o) {
    const j = await getJSON(`${BASE}/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${expiry}&greeks=true`, { headers: hdr(o?.key), signal: o?.signal });
    return parseTradierChain(j, expiry);
  },
};
