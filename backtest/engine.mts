/*
 * Genel backtest motoru: herhangi bir Strategy (src/lib/odte/strategies) + herhangi bir QuoteSource (sources.mts).
 * Değerlendirme 5 dk'da bir (uygulamanın yenileme aralığı), yalnızca TAMAMLANMIŞ 1 dk barlarla; hisse başına aynı anda tek pozisyon.
 * Giriş: sinyalden sonraki barın açılışında ASK + kayma. Çıkış: dayanak hedef/stop (aynı barda ikisi → stop), zaman stopu
 * (maxHoldMin) ya da gün sonu (0DTE 15:30, diğer 15:45 ET) — BID − kayma. Komisyon kontrat/yön başına.
 */
import { metrics, group, type Day, type Met } from './bt.mts';
import { defaultCosts, makeSource, type Costs, type QuoteSource, type Side } from './sources.mts';
import { pickContract, type CommonParams, type DayInfo, type StratCtx, type StratEntry, type Strategy } from '../src/lib/odte/strategies/index.ts';
import type { Bar } from '../src/lib/odte/analytics.ts';

export interface ETrade {
  strat: string; ticker: string; D: string; m: number; dir: Side; dte: number; K: number;
  entry: number; exit: number; pnl: number; pct: number; why: 'target' | 'stop' | 'time' | 'hold';
  score: number; exitT: number; holdMin: number; src: string; note?: string;
}
export interface RunOpts { source?: QuoteSource; costs?: Costs }

export function dayInfo(d: Day): DayInfo {
  const p0 = d.pts.find(p => p.F.em); const em = p0?.F.em?.move ?? null;
  return { ticker: d.ticker, date: d.D, dte: d.dte, prevClose: d.SP ?? null, openPx: d.bars[0]?.o ?? NaN, em0: em != null ? em / Math.sqrt(1 + d.dte) : null };
}
function validEntry(e: StratEntry, S: number) {
  const sg = e.dir === 'call' ? 1 : -1;
  return isFinite(e.undTarget) && isFinite(e.undStop) && sg * (e.undTarget - S) > 0 && sg * (S - e.undStop) > 0;
}
export function simulateEntry(d: Day, t: number, S: number, e: StratEntry, p: CommonParams, src: QuoteSource, costs: Costs, strat: string): ETrade | null {
  if (!validEntry(e, S)) return null;
  const ch = src.chain(d, S, t, e.dir);
  const q = pickContract(ch, e.dir, S, { targetDelta: e.targetDelta ?? p.targetDelta, maxSpread: p.maxSpread, minVol: p.minVol, minOI: p.minOI });
  if (!q) return null;
  let k = d.bars.findIndex(b => b.t >= t); if (k < 0) return null;
  const b0 = d.bars[k], f0 = src.quote(d, e.dir, q.strike, b0.o, b0.t); if (!f0) return null;
  const entry = +(f0.ask + costs.slip).toFixed(2); if (!(entry > 0.05)) return null;
  const eod = d.close - (d.dte === 0 ? 30 : 15) * 60000, hold = e.maxHoldMin != null ? b0.t + e.maxHoldMin * 60000 : Infinity;
  const exitT = Math.min(eod, hold), call = e.dir === 'call';
  let Sx = NaN, tx = 0, why: ETrade['why'] = 'time';
  for (; k < d.bars.length; k++) {
    const b = d.bars[k];
    if (b.t >= exitT) { Sx = b.o; tx = b.t; why = exitT === hold && hold < eod ? 'hold' : 'time'; break; }
    const stopOpen = call ? b.o <= e.undStop : b.o >= e.undStop, stopHit = call ? b.l <= e.undStop : b.h >= e.undStop;
    const tgtOpen = call ? b.o >= e.undTarget : b.o <= e.undTarget, tgtHit = call ? b.h >= e.undTarget : b.l <= e.undTarget;
    if (stopOpen) { Sx = b.o; tx = b.t; why = 'stop'; break; }
    if (stopHit) { Sx = e.undStop; tx = b.t + 30000; why = 'stop'; break; }
    if (tgtOpen) { Sx = b.o; tx = b.t; why = 'target'; break; }
    if (tgtHit) { Sx = e.undTarget; tx = b.t + 30000; why = 'target'; break; }
  }
  if (!isFinite(Sx)) { const b = d.bars[d.bars.length - 1]; Sx = b.c; tx = b.t + 60000; }
  const fx = src.quote(d, e.dir, q.strike, Sx, tx); if (!fx) return null;
  const exit = Math.max(0, +(fx.bid - costs.slip).toFixed(2)), pnl = (exit - entry) * 100 - 2 * costs.fee;
  return { strat, ticker: d.ticker, D: d.D, m: Math.round((t - d.open) / 60000), dir: e.dir, dte: d.dte, K: q.strike, entry, exit, pnl, pct: pnl / (entry * 100), why,
    score: e.score ?? 0, exitT: tx, holdMin: Math.round((tx - b0.t) / 60000), src: f0.src === fx.src ? f0.src : 'mixed', note: e.note };
}
/** Bir stratejiyi bir parametre setiyle günler üzerinde oynat (günler precompute() edilmiş olmalı) */
export function runStrategy<P extends CommonParams>(days: Day[], s: Strategy<P>, p: P, o: RunOpts = {}): ETrade[] {
  const costs = o.costs ?? defaultCosts(), src = o.source ?? makeSource(undefined, costs), out: ETrade[] = [];
  for (const d of days) {
    const info = dayInfo(d), mem: Record<string, unknown> = {};
    let busy = 0, cnt = 0, n = 0;
    for (const pt of d.pts) {
      while (n < d.bars.length && d.bars[n].t + 60000 <= pt.t) n++;
      if (pt.t < busy || cnt >= p.maxPerDay) continue;
      const bars: Bar[] = d.bars.slice(0, n);
      const ctx: StratCtx = { ticker: d.ticker, S: pt.S, t: pt.t, m: pt.m, bars, F: pt.F, day: info, chain: side => src.chain(d, pt.S, pt.t, side), mem };
      const e = s.evaluate(ctx, p); if (!e) continue;
      const tr = simulateEntry(d, pt.t, pt.S, e, p, src, costs, s.id); if (!tr) continue;
      out.push(tr); busy = tr.exitT + 60000; cnt++;
    }
  }
  return out;
}
/* ——— metrikler ——— */
export interface XMet extends Met { ci95: [number, number]; sharpeD: number; days: number; avgHold: number; realShare: number }
/** Önyükleme (bootstrap) ile işlem başı % beklentinin %95 güven aralığı + günlük Sharpe (yıllık) */
export function xmetrics(ts: ETrade[], B = 1000, seed = 7): XMet {
  const m = metrics(ts as any) as Met;
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pc = ts.map(t => t.pct), n = pc.length, bs: number[] = [];
  if (n >= 5) for (let b = 0; b < B; b++) { let a = 0; for (let i = 0; i < n; i++) a += pc[Math.floor(rnd() * n)]; bs.push(a / n); }
  bs.sort((a, b) => a - b);
  const byD = [...group(ts as any, (t: any) => t.D).values()].map(v => (v as ETrade[]).reduce((a, x) => a + x.pnl, 0));
  const mu = byD.reduce((a, b) => a + b, 0) / Math.max(1, byD.length), sd = Math.sqrt(byD.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, byD.length - 1));
  return { ...m, ci95: bs.length ? [bs[Math.floor(0.025 * B)], bs[Math.floor(0.975 * B)]] : [NaN, NaN], sharpeD: sd > 0 ? mu / sd * Math.sqrt(252) : 0, days: byD.length,
    avgHold: n ? ts.reduce((a, t) => a + t.holdMin, 0) / n : NaN, realShare: n ? ts.filter(t => t.src === 'real').length / n : 0 };
}
export const etHH = (m: number) => { const t = 570 + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${t % 60 < 30 ? '00' : '30'}`; };
export function breakdown(ts: ETrade[]) {
  const f = (g: Map<any, any[]>) => [...g.entries()].map(([k, v]) => ({ k: String(k), ...metrics(v) })).sort((a, b) => a.k.localeCompare(b.k));
  return { ticker: f(group(ts as any, (t: any) => t.ticker)), tod: f(group(ts as any, (t: any) => etHH(t.m))), dir: f(group(ts as any, (t: any) => t.dir)),
    why: f(group(ts as any, (t: any) => t.why)), dte: f(group(ts as any, (t: any) => t.dte === 0 ? '0' : t.dte === 1 ? '1' : '2+')) };
}
