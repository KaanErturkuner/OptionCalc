/*
 * Opsiyon fiyat kaynakları (backtest). Motor her giriş/çıkışta kaynağa sorar:
 *  - modeled  : önceki gün EOD IV + yarım spread ile Leisen-Reimer Amerikan fiyat (deneme verisiyle yapılan v1/v2 testleri).
 *  - recorded : GERÇEK gün içi zincir anlık görüntüleri (backtest/record.mts ile ileriye dönük kaydedilir; MarketData geçmişte
 *               gün içi opsiyon kotu SUNMUYOR — geçmiş opsiyon verisi yalnızca EOD). En yakın önceki anlık görüntünün bid/ask'ı.
 *  - hybrid   : kayıt varsa recorded, yoksa modeled (işlem kaydında hangisinin kullanıldığı `src` alanında).
 * Maliyet ayarları: SPREAD_MULT (modeled spread çarpanı), SLIP, FEE (varsayılan 1,50 $/kontrat/yön, Midas — Kaan D8/D12) — duyarlılık için ortam değişkeniyle değişir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { snapshot, R, ivAt, type Day } from './bt.mts';
import { americanPrice, FAST_STEPS } from '../src/lib/american.ts';
import { closeMs, YEAR_MS } from '../src/lib/usmarket.ts';
import type { Chain, OptQuote } from '../src/lib/market/types.ts';

export type Side = 'call' | 'put';
export interface Fill { bid: number; ask: number; src: 'model' | 'real' }
export interface Costs { fee: number; slip: number; spreadMult: number }
export const defaultCosts = (): Costs => ({ fee: +(process.env.BT_FEE ?? 1.5), slip: +(process.env.BT_SLIP ?? 0.01), spreadMult: +(process.env.BT_SPREAD_MULT ?? 1) });
export interface QuoteSource {
  id: string;
  /** t anında zincir (kontrat seçimi için) */
  chain(d: Day, S: number, t: number, side?: Side): Chain;
  /** t anında tek kontratın bid/ask'ı (S = o anki dayanak) */
  quote(d: Day, type: Side, K: number, S: number, t: number): Fill | null;
  /** Kaynak bu gün için gerçek veri içeriyor mu */
  hasDay?(d: Day): boolean;
}
const tOf = (d: Day, t: number) => Math.max((closeMs(d.E) - t) / YEAR_MS, 1e-7);

/** Zincir önbelleği üst sınırı (girdi). Her girdi ~200 kontrat satırı: 50 000 girdi GB'larca bellek → GC duraklamaları. Sonuçları değiştirmez. */
const CHAIN_CACHE_MAX = +(process.env.BT_CHAIN_CACHE || 4000);
export function modeledSource(costs = defaultCosts()): QuoteSource {
  const cache = new Map<string, Chain>();
  return {
    id: 'modeled',
    chain(d, S, t, side) {
      // Anahtarda son kullanım (E) şart: aynı ticker+gün için 0DTE ve 1–3 DTE zincirleri farklıdır (önbellek karışmasın).
      const k = `${d.ticker}|${d.D}|${d.E}|${t}|${side ?? ''}`; let c = cache.get(k);
      if (!c) { c = snapshot(d, S, t, side); if (cache.size > CHAIN_CACHE_MAX) cache.clear(); cache.set(k, c); }
      return c;
    },
    quote(d, type, K, S, t) {
      const row = d.rows.find(r => r.type === type && r.K === K); if (!row) return null;
      const m = americanPrice(type, S, K, tOf(d, t), R, 0, ivAt(row.iv, t, d.E), [], FAST_STEPS);
      const h = row.half * costs.spreadMult;
      return { bid: Math.max(0, m - h), ask: m + h, src: 'model' };
    },
  };
}
/* ——— kaydedilmiş gerçek anlık görüntüler ——— */
export const SNAPS = process.env.BT_SNAPS || '/workspace/backtest/snaps';
/** Kayıt satırı: {t, S, E, rows: [[0=call|1=put, K, bid, ask, iv, delta, gamma, vol, oi], ...]} */
export interface Snap { t: number; S: number; E: string; rows: number[][] }
export function loadSnaps(ticker: string, D: string, dir = SNAPS): Snap[] {
  const f = path.join(dir, D, `${ticker}.jsonl`); if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Snap).sort((a, b) => a.t - b.t);
}
export function snapToChain(s: Snap, side?: Side): Chain {
  const calls: OptQuote[] = [], puts: OptQuote[] = [];
  for (const r of s.rows) {
    const type: Side = r[0] ? 'put' : 'call'; if (side && side !== type) continue;
    const q: OptQuote = { type, strike: r[1], bid: r[2], ask: r[3], last: (r[2] + r[3]) / 2, iv: r[4] || null, delta: r[5] || undefined, gamma: r[6] || undefined, volume: r[7] || 0, oi: r[8] || 0 };
    (type === 'call' ? calls : puts).push(q);
  }
  return { expiry: s.E, calls, puts, updated: s.t, underlying: s.S };
}
export function recordedSource(opts: { maxStaleMs?: number; fallback?: QuoteSource; costs?: Costs } = {}): QuoteSource {
  const maxStale = opts.maxStaleMs ?? 6 * 60000, fb = opts.fallback, costs = opts.costs ?? defaultCosts();
  const mem = new Map<string, Snap[]>();
  const snaps = (d: Day) => { const k = d.ticker + '|' + d.D + '|' + d.E; let s = mem.get(k); if (!s) { s = loadSnaps(d.ticker, d.D).filter(x => x.E === d.E); mem.set(k, s); } return s; };
  const at = (d: Day, t: number) => { const s = snaps(d); let lo = 0, hi = s.length - 1, best = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 && t - s[best].t <= maxStale ? s[best] : null; };
  return {
    id: fb ? 'hybrid' : 'recorded',
    hasDay: d => snaps(d).length > 0,
    chain(d, S, t, side) { const s = at(d, t); if (s) return snapToChain(s, side); if (fb) return fb.chain(d, S, t, side); return { expiry: d.E, calls: [], puts: [] }; },
    quote(d, type, K, S, t) {
      const s = at(d, t);
      if (s) {
        const r = s.rows.find(x => (x[0] ? 'put' : 'call') === type && x[1] === K);
        if (r && r[3] > 0) {
          // anlık görüntüden bu yana dayanak hareketi: delta ile kaydır (kayıt aralığı kısa olduğundan küçük düzeltme)
          const dS = S - s.S, adj = (r[5] || 0) * dS + 0.5 * (r[6] || 0) * dS * dS, h = (r[3] - r[2]) / 2 * costs.spreadMult, m = (r[2] + r[3]) / 2 + adj;
          return { bid: Math.max(0, m - h), ask: Math.max(0.01, m + h), src: 'real' };
        }
      }
      return fb ? fb.quote(d, type, K, S, t) : null;
    },
  };
}
export function makeSource(kind = process.env.BT_SOURCE || 'modeled', costs = defaultCosts()): QuoteSource {
  if (kind === 'recorded') return recordedSource({ costs });
  if (kind === 'hybrid') return recordedSource({ fallback: modeledSource(costs), costs });
  return modeledSource(costs);
}
