/* Paper/replay tablolarında ortak yardımcılar (firsat.mts ve qull.mts). Node'a özgü; yalnız biçimlendirme ve işlem→yol dönüşümü. */
import type { ETrade } from './engine.mts';
import type { PathTrade } from '../src/lib/paper/path.ts';

export const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—';
export const f2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : '—';
export const usd = (x: number) => Number.isFinite(x) ? x.toFixed(0) + ' $' : '—';
/** Motor işlemi (ETrade) → yol işlemi (PathTrade) */
export const toPath = (t: ETrade): PathTrade => ({ id: `${t.strat}|${t.ticker}|${t.D}|${t.m}`, ticker: t.ticker, dir: t.dir, dte: t.dte, D: t.D, entryT: t.entryT, exitT: t.exitT, fill: t.entry, R: t.R, hit: t.hit, stopped: t.stopped });
