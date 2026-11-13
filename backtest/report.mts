/* Sayfa için özet: v1 (taban) vs v2 (yeni varsayılan) — eğitim/test, hisse, saat, yön, DTE, sermaye eğrisi. → /workspace/backtest/report.json */
import fs from 'node:fs';
import { loadDays, precompute, run, metrics, group, type Trade } from './bt.mts';
import * as SG from '../src/lib/odte/signal.ts';
import { TICKERS } from './common.mts';
const days = loadDays(TICKERS); for (const d of days) precompute(d);
const dates = [...new Set(days.map(d => d.D))].sort(), cut = dates[Math.floor(dates.length * 0.7)];
const r2 = (x: number) => +x.toFixed(4);
const M = (ts: Trade[]) => { const m = metrics(ts); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, isFinite(v as number) ? r2(v as number) : null])); };
const etH = (m: number) => { const t = 570 + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${t % 60 < 30 ? '00' : '30'}`; };
const by = (ts: Trade[], f: (t: Trade) => string) => [...group(ts, f)].map(([k, v]) => ({ k, tr: M(v.filter(t => t.D < cut)), te: M(v.filter(t => t.D >= cut)), all: M(v) })).sort((a, b) => a.k.localeCompare(b.k));
const pack = (p: any) => {
  const ts = run(days, p); let eq = 0; const byD = group(ts, t => t.D);
  return { tr: M(ts.filter(t => t.D < cut)), te: M(ts.filter(t => t.D >= cut)), all: M(ts),
    ticker: by(ts, t => t.ticker), tod: by(ts, t => etH(t.m)), dir: by(ts, t => t.dir), dte: by(ts, t => t.dte === 0 ? '0' : t.dte === 1 ? '1' : t.dte <= 3 ? '2-3' : '4+'), why: by(ts, t => t.why),
    curve: dates.map(D => { for (const t of byD.get(D) ?? []) eq += t.pnl; return +eq.toFixed(0); }) };
};
const out = { dates: { first: dates[0], last: dates[dates.length - 1], n: dates.length, cut, nTr: dates.filter(d => d < cut).length }, dates_list: dates,
  v1: pack({ ...SG.V1_OPTS, maxPerDay: 99 }), v2: pack({ ...SG.DEFAULT_OPTS, maxPerDay: 99 }), v2d2: pack({ ...SG.DEFAULT_OPTS, maxPerDay: 2 }),
  v2core: pack({ ...SG.DEFAULT_OPTS, maxPerDay: 2, tickers: ['SPY', 'QQQ', 'IWM', 'TSLA', 'NBIS', 'SPCX', 'GLD', 'SLV'] }) };
fs.writeFileSync('/workspace/backtest/report.json', JSON.stringify(out));
for (const k of ['v1', 'v2', 'v2d2', 'v2core'] as const) console.log(k, 'TR', JSON.stringify(out[k].tr), '\n   TE', JSON.stringify(out[k].te));
