/* Model doğrulama: D−1 EOD IV ile modellenen D kapanış fiyatı vs gerçek D EOD orta fiyat (vadesi D'den sonra olan, delta 0,25–0,75 kontratlar) */
import fs from 'node:fs';
import { loadDays, R, ivAt } from './bt.mts';
import { closeMs } from '../src/lib/usmarket.ts';
import { TICKERS } from './common.mts';
import * as BS from '../src/lib/bs.ts';
import { americanPrice, FAST_STEPS } from '../src/lib/american.ts';
const days = loadDays(process.env.BT_TICKERS?.split(',') ?? TICKERS);
const errs: number[] = [], amer: number[] = [], per: Record<string, number[]> = {};
for (const d of days) {
  if (d.dte < 1 || !d.SD) continue;
  const k = ivAt(1, closeMs(d.D), d.E);
  for (const r0 of d.rows) {
    const r = { ...r0, iv: r0.iv * k };
    if (r.filled || r.dMid == null || r.dMid < 0.2) continue;
    const g = BS.greeks(r.type, d.SD, r.K, d.TD, R, 0, r.iv); if (Math.abs(g.delta) < 0.25 || Math.abs(g.delta) > 0.75) continue;
    const m = BS.price(r.type, d.SD, r.K, d.TD, R, 0, r.iv), e = m / r.dMid - 1;
    errs.push(e); (per[d.ticker] ??= []).push(e);
    if (r.type === 'put' && amer.length < 3000) amer.push(americanPrice('put', d.SD, r.K, d.TD, R, 0, r.iv, [], FAST_STEPS) / m - 1);
  }
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const absMed = (a: number[]) => q(a.map(Math.abs), 0.5);
const out = { n: errs.length, bias: q(errs, 0.5), absMed: absMed(errs), p90abs: q(errs.map(Math.abs), 0.9), amerPutPremMed: q(amer, 0.5),
  perTicker: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { n: v.length, bias: q(v, 0.5), absMed: absMed(v) }])) };
fs.writeFileSync('/workspace/backtest/validation.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
