/* Takip listesi yenileme: saf eşleme. Zincir alımı dışarıdan verilir (sunucu proxy'si üzerinden); burada yalnız seçim ve birleştirme var. */
import { mid, type Chain } from '../market/types.ts';
import { isExpired, liveKeys, type OptType, type WatchItem } from './model.ts';

export interface ContractQuote { premium: number | null; bid: number; ask: number; iv: number | null }
/** Zincirde kontratı bul; prim = mid (bid/ask yoksa son işlem) */
export function pickContract(ch: Chain, type: OptType, strike: number): ContractQuote | null {
  const list = type === 'call' ? ch.calls : ch.puts;
  const q = list.find(x => Math.abs(x.strike - strike) < 1e-9);
  if (!q) return null;
  const m = mid(q);
  return { premium: m > 0 ? +m.toFixed(2) : null, bid: q.bid, ask: q.ask, iv: q.iv };
}

export interface ChainFetch { chain: Chain; provider: string }
export interface RefreshResult { items: WatchItem[]; errors: Record<string, string>; fetched: number }

/**
 * Kalemleri yeniler. Her (sembol, vade) çifti için bir zincir isteği (vadesi dolanlar hiç istenmez).
 * Hata: o çiftin kalemleri son bilinen fiyatla kalır, `errors` anahtarı "SEMBOL|VADE".
 */
export async function refreshItems(items: WatchItem[], fetchChain: (symbol: string, expiry: string) => Promise<ChainFetch>, now: number): Promise<RefreshResult> {
  const errors: Record<string, string> = {};
  const byKey = new Map<string, ChainFetch>();
  let fetched = 0;
  for (const k of liveKeys(items, now)) {
    const key = k.symbol + '|' + k.expiry;
    try { byKey.set(key, await fetchChain(k.symbol, k.expiry)); fetched++; }
    catch (e) { errors[key] = e instanceof Error ? e.message : 'Veri alınamadı'; }
  }
  const out = items.map(it => {
    if (isExpired(it.expiry, now)) return it;
    const key = it.symbol + '|' + it.expiry;
    const f = byKey.get(key);
    if (!f) return it;
    const q = pickContract(f.chain, it.type, it.strike);
    if (!q) { errors[key] = errors[key] || 'Kontrat zincirde yok'; return it; }
    const prev = it.last;
    return { ...it, last: {
      premium: q.premium ?? prev?.premium ?? null,
      underlying: f.chain.underlying ?? prev?.underlying ?? null,
      at: now, provider: f.provider,
    } };
  });
  return { items: out, errors, fetched };
}
