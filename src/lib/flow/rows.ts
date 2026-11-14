/*
 * MarketData sütun-biçimli yanıtı (chain / quotes) kontrat satırlarına çevirir. Saf.
 * Tek kontrat (options/quotes) ve çok vadeli zincir (dte listesi) aynı biçimi kullanır.
 */
import { etDate } from '../usmarket.ts';
import { num, parseOcc } from '../market/types.ts';
import type { ChainRow } from './detect.ts';

export function parseChainRows(j: any): ChainRow[] {
  if (!j || !Array.isArray(j.optionSymbol)) return [];
  const col = (k: string, i: number) => (Array.isArray(j[k]) ? j[k][i] : undefined);
  const out: ChainRow[] = [];
  for (let i = 0; i < j.optionSymbol.length; i++) {
    const occ = String(col('optionSymbol', i) ?? '');
    const pm = parseOcc(occ);
    if (!pm) continue;
    const expUnix = num(col('expiration', i));
    out.push({
      occ, ticker: String(col('underlying', i) ?? pm.root), expiry: expUnix ? etDate(expUnix * 1000) : pm.expiry,
      side: col('side', i) === 'put' ? 'put' : 'call', strike: num(col('strike', i)),
      volume: num(col('volume', i)), oi: num(col('openInterest', i)),
      bid: num(col('bid', i)), ask: num(col('ask', i)), last: num(col('last', i)),
      updated: num(col('updated', i)) * 1000, underlying: num(col('underlyingPrice', i)) || null,
    });
  }
  return out;
}
