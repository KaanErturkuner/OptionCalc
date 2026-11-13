/* Tarama anlık görüntüsü: sağlayıcı verisinden Snapshot (saf; ağ çağrısı yok). */
import { buildSmile, pAbove, skew as skewOf } from '../prob/implied.ts';
import { impliedVol } from '../bs.ts';
import { mid, type Chain, type OptQuote } from '../market/types.ts';
import * as An from '../odte/analytics.ts';
import type { Bar } from '../odte/analytics.ts';
import { closeMs, etDate, YEAR_MS } from '../usmarket.ts';
import { optKey } from './detectors/util.ts';
import type { Snapshot } from './types.ts';
import { isEtf } from './universe.ts';

export interface SnapInput {
  ticker: string; price: number; changePct: number; chain: Chain; expiry: string; bars: Bar[]; now: number;
  source: string; delayedMin: number; dataTime?: number; r?: number;
  prevOi?: Record<string, number> | null; atmIvSession0?: number | null;
  sector?: { ticker: string; changePct: number } | null;
  earnings?: { date: string; days: number } | null; earningsImpliedPct?: number | null; earningsHistPct?: number | null;
}
/** OI haritası (`C180`, `P175` …) — bir sonraki günün karşılaştırması için saklanır */
export function oiMap(ch: Chain): Record<string, number> {
  const m: Record<string, number> = {};
  for (const o of [...ch.calls, ...ch.puts]) m[optKey(o.type, o.strike)] = o.oi;
  return m;
}
const ivOf = (o: OptQuote, S: number, T: number, r: number) => (o.iv != null && o.iv > 0.001 ? o.iv : impliedVol(o.type, mid(o), S, o.strike, T, r, 0));

export function buildSnapshot(inp: SnapInput): Snapshot {
  const { now, price: S, chain } = inp, r = inp.r ?? 0.04, today = etDate(now);
  const dte = Math.max(0, Math.round((Date.parse(inp.expiry) - Date.parse(today)) / 864e5));
  const T = Math.max((closeMs(inp.expiry) - now) / YEAR_MS, 1 / (365 * 24 * 60));
  const bars = An.sessionBars(inp.bars, now);
  const mo = An.momentum(bars), or = An.openingRange(bars, 15), orOk = or?.complete ? or : null;
  const em = An.expectedMove(chain, S);
  // ATM IV: en yakın strike'ta call/put IV ortalaması
  const atmK = [...new Set([...chain.calls, ...chain.puts].map(o => o.strike))].sort((a, b) => Math.abs(a - S) - Math.abs(b - S))[0];
  const atmQs = [...chain.calls, ...chain.puts].filter(o => o.strike === atmK);
  const atmIvs = atmQs.map(o => ivOf(o, S, T, r)).filter(x => isFinite(x) && x > 0);
  const atmIv = atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null;
  const sm = buildSmile(chain, S, T, r, 0);
  const sk = sm.pts.length >= 3 ? skewOf(sm) : null;
  const gx = An.gex(chain, S, now), w = An.oiWalls(chain), ra = An.ratios(chain);
  const vols = [...chain.calls, ...chain.puts].filter(o => o.volume > 0);
  const totalVol = ra.callVol + ra.putVol;
  const sector = inp.sector ?? null;
  return {
    ticker: inp.ticker, isEtf: isEtf(inp.ticker), spot: S, changePct: inp.changePct, now,
    source: inp.source, dataAgeSec: Math.max(0, Math.round((now - (inp.dataTime ?? now)) / 1000)), delayedMin: inp.delayedMin,
    bars, vwap: An.vwap(bars), orHigh: orOk ? orOk.high : null, orLow: orOk ? orOk.low : null,
    ema9: mo?.ema9 ?? null, ema21: mo?.ema21 ?? null,
    expiry: inp.expiry, dte, chain,
    expectedMove: em?.move ?? null, emPct: em?.pct ?? null,
    atmIv, atmIvSession0: inp.atmIvSession0 ?? null,
    skew: sk, rr25: sk?.rr25 ?? null, probUp: sm.pts.length >= 3 ? pAbove(sm, S) : null,
    callWall: w.callWall, putWall: w.putWall, maxPain: An.maxPain(chain), flip: gx.flip, netGex: gx.net,
    pcVol: ra.pcVol, totalVol: totalVol > 0 ? totalVol : null,
    avgContractVol: vols.length ? totalVol / vols.length : null,
    prevOi: inp.prevOi ?? null,
    sector,
    earnings: inp.earnings ?? null, earningsImpliedPct: inp.earningsImpliedPct ?? null, earningsHistPct: inp.earningsHistPct ?? null,
  };
}
