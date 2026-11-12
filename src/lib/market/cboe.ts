/* CBOE gecikmeli kotasyonlar (anahtarsız, ~15 dk gecikmeli): fiyat, tüm zincir, IV ve Greek'ler */
import { closeMs, marketOpen } from '../usmarket.ts';
import { getJSON, num, parseOcc, type Chain, type OptQuote, type Provider, type Quote } from './types.ts';

const BASE = 'https://cdn-api.cboe.com/api/global/delayed_quotes';
const INDEX = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX', 'OEX', 'XEO', 'MRUT', 'NANOS']);
export const cboeSym = (s: string) => (INDEX.has(s) ? '_' : '') + s;

/** "2026-11-11T15:59:59" (New York saati) → UTC ms */
export function etNaive(s: string | undefined): number {
  if (!s) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):?(\d{2})?/.exec(s); if (!m) return NaN;
  const close = closeMs(`${m[1]}-${m[2]}-${m[3]}`); // 16:00 ET
  return close + ((+m[4] - 16) * 3600 + +m[5] * 60 + +(m[6] || 0)) * 1000;
}
/** Seans kapalıyken resmi kapanışı kullan (opsiyon kotasyonları da kapanışta donmuştur); seans dışı fiyatı ayrıca göster */
export function parseCboeQuote(j: any, symbol: string, now = Date.now()): Quote {
  const d = j?.data; if (!d || !(num(d.current_price) > 0 || num(d.close) > 0)) throw new Error('Sembol bulunamadı');
  const cur = num(d.current_price), cls = num(d.close), open = marketOpen(now);
  const price = open ? (cur || cls) : (cls || cur);
  const extPrice = !open && cur > 0 && cls > 0 && Math.abs(cur - cls) > 0.005 ? cur : undefined;
  return {
    symbol, price, change: num(d.price_change), changePct: num(d.price_change_percent), prevClose: num(d.prev_day_close) || undefined,
    bid: num(d.bid) || undefined, ask: num(d.ask) || undefined, extPrice, time: etNaive(d.last_trade_time), delayedMin: 15,
    iv30: num(d.iv30) || undefined, source: 'CBOE',
  };
}
/** Tüm zinciri vade → Chain olarak ayrıştırır; geçmiş vadeleri ve düzeltilmiş (kökü rakamla biten) kontratları atar */
export function parseCboeChains(j: any, symbol: string, now = Date.now()): Map<string, Chain> {
  const out = new Map<string, Chain>(), seen = new Map<string, OptQuote & { _w: boolean }>();
  for (const o of j?.data?.options || []) {
    const p = parseOcc(String(o.option || '')); if (!p) continue;
    if (/\d$/.test(p.root) && !/\d$/.test(symbol)) continue;
    if (closeMs(p.expiry) <= now) continue;
    const iv = num(o.iv);
    const q: OptQuote = { type: p.type, strike: p.strike, bid: num(o.bid), ask: num(o.ask), last: num(o.last_trade_price),
      iv: iv > 0.005 && iv < 10 ? iv : null, volume: num(o.volume), oi: num(o.open_interest), delta: num(o.delta) };
    const key = `${p.expiry}|${p.type}|${p.strike}`, weekly = p.root !== symbol; // SPX / SPXW aynı gün: PM (W) tercih
    const prev = seen.get(key);
    if (prev && !(prev._w === false && weekly)) continue;
    seen.set(key, { ...q, _w: weekly });
  }
  for (const [key, q] of seen) {
    const exp = key.split('|')[0];
    let c = out.get(exp); if (!c) { c = { expiry: exp, calls: [], puts: [] }; out.set(exp, c); }
    const { _w, ...clean } = q; void _w;
    (q.type === 'call' ? c.calls : c.puts).push(clean);
  }
  for (const c of out.values()) { c.calls.sort((a, b) => a.strike - b.strike); c.puts.sort((a, b) => a.strike - b.strike); }
  return new Map([...out.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const cache = new Map<string, { t: number; quote: Quote; chains: Map<string, Chain> }>();
const TTL = 60000;
async function full(symbol: string, signal?: AbortSignal) {
  const hit = cache.get(symbol); if (hit && Date.now() - hit.t < TTL) return hit;
  const j = await getJSON(`${BASE}/options/${cboeSym(symbol)}.json`, { signal, timeoutMs: 30000, headers: { Accept: 'application/json' } })
    .catch(e => { if (e?.status === 403 || e?.status === 404) throw new Error('Sembol bulunamadı veya opsiyonu yok'); throw e; });
  const v = { t: Date.now(), quote: parseCboeQuote(j, symbol), chains: parseCboeChains(j, symbol) };
  if (!v.chains.size) throw new Error('Opsiyon zinciri boş');
  cache.set(symbol, v); return v;
}
export const cboe: Provider = {
  id: 'cboe', name: 'CBOE (gecikmeli, anahtarsız)', delayedMin: 15, needsKey: false,
  async load(symbol, o) { const v = await full(symbol, o?.signal); return { quote: v.quote, expirations: [...v.chains.keys()] }; },
  async chain(symbol, expiry, o) {
    const v = await full(symbol, o?.signal), c = v.chains.get(expiry);
    if (!c) throw new Error('Bu vade için veri yok'); return c;
  },
};
export const clearCboeCache = () => cache.clear();
