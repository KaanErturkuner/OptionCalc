/* Poller satırlarından (ChainRow) duvar/flip/max pain anlık görüntüsü. Saf: analytics.ts yeniden kullanılır. */
import type { ChainRow } from '../flow/detect.ts';
import type { Chain, OptQuote } from '../market/types.ts';
import * as An from '../odte/analytics.ts';
import type { WallSnap } from './types.ts';

/** En yakın vade (bugün veya sonrası) için duvarlar. IV satırda yok → Γ için analytics varsayılanı (0,30) kullanılır. */
export function wallSnapFromRows(rows: ChainRow[], day: string, nowMs: number): WallSnap | null {
  const exps = [...new Set(rows.map(r => r.expiry))].filter(e => e >= day).sort();
  const expiry = exps[0];
  if (!expiry) return null;
  const sel = rows.filter(r => r.expiry === expiry);
  const q = (r: ChainRow): OptQuote => ({ type: r.side, strike: r.strike, bid: r.bid, ask: r.ask, last: r.last, iv: null, volume: r.volume, oi: r.oi });
  const chain: Chain = { expiry, calls: sel.filter(r => r.side === 'call').map(q), puts: sel.filter(r => r.side === 'put').map(q) };
  const spot = sel.find(r => r.underlying)?.underlying ?? null;
  if (spot == null) return null;
  const w = An.oiWalls(chain);
  const gx = An.gex(chain, spot, nowMs);
  return { spot, callWall: w.callWall, putWall: w.putWall, flip: gx.flip, maxPain: An.maxPain(chain), expiry, at: nowMs };
}
