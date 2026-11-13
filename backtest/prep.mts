/* Önbellekteki ham MarketData yanıtlarından gün kayıtları üret: /workspace/backtest/days/<T>.json
 * Her gün D için: 1 dk barlar (D), en yakın vade E ≥ D, kontratlar: OI (D zinciri → D−1 seansından, ileriye bakış yok),
 * IV + yarım spread + hacim (önceki işlem günü P'nin EOD zincirinden), doğrulama için D'nin EOD orta fiyatı. */
import fs from 'node:fs';
import { get, close } from './md.mts';
import { TICKERS, tradingDays, addDaysStr, START, END } from './common.mts';
import * as BS from '../src/lib/bs.ts';
import { tauYears } from './bt.mts';
import { closeMs, etDate, YEAR_MS } from '../src/lib/usmarket.ts';
/* BT_DAYS: çıktı dizini; BT_MIN_DTE/BT_MAX_DTE: vade seçimi (vars. en yakın vade; ör. 1–3DTE varyantı için BT_MIN_DTE=1 BT_MAX_DTE=3) */
const OUT = process.env.BT_DAYS || '/workspace/backtest/days', MIN_DTE = +(process.env.BT_MIN_DTE || 0), MAX_DTE = +(process.env.BT_MAX_DTE || 99); fs.mkdirSync(OUT, { recursive: true });
const R = 0.04;
const tickers = process.env.BT_TICKERS?.split(',') ?? TICKERS;
const months: [string, string][] = [];
for (let m = START.slice(0, 7); m <= END.slice(0, 7);) { const a = m + '-01'; const n = new Date(Date.parse(a) + 32 * 864e5).toISOString().slice(0, 7); months.push([a, n + '-01']); m = n; }
const allDays = tradingDays(addDaysStr(START, -4), END);
let gotAny = 0;
for (const t of tickers) {
  const closes = new Map<string, number>(), bars = new Map<string, number[][]>();
  for (const [a, b] of months) {
    const j = await get(`/stocks/candles/1/${t}/?from=${a}&to=${b}`);
    if (Array.isArray(j?.t)) for (let i = 0; i < j.t.length; i++) {
      const d = new Date((j.t[i] - 5 * 3600) * 1000).toISOString().slice(0, 10); closes.set(d, j.c[i]);
      const dd = etDate(j.t[i] * 1000); if (!bars.has(dd)) bars.set(dd, []);
      bars.get(dd)!.push([j.t[i] * 1000, j.o[i], j.h[i], j.l[i], j.c[i], j.v?.[i] ?? 0]);
    }
  }
  const dj = await get(`/stocks/candles/D/${t}/?from=${addDaysStr(START, -10)}&to=${END}`);
  if (Array.isArray(dj?.t)) for (let i = 0; i < dj.t.length; i++) { const d = new Date((dj.t[i] + 12 * 3600) * 1000).toISOString().slice(0, 10); if (!closes.has(d)) closes.set(d, dj.c[i]); }
  const chainOf = async (d: string) => {
    const ks = [...closes.keys()].filter(x => x < d).sort(); const pc = closes.get(ks[ks.length - 1]!); if (!pc) return null;
    const lo = (pc * 0.84).toFixed(2), hi = (pc * 1.16).toFixed(2);
    let j = await get(`/options/chain/${t}/?date=${d}&from=${d}&to=${addDaysStr(d, 10)}&strike=${lo}-${hi}`);
    if (j?.s !== 'ok') j = await get(`/options/chain/${t}/?date=${d}&from=${d}&to=${addDaysStr(d, 45)}&strike=${lo}-${hi}`);
    return j?.s === 'ok' ? j : null;
  };
  const out: any[] = [];
  for (let i = 1; i < allDays.length; i++) {
    const D = allDays[i], P = allDays[i - 1];
    if (D < START) continue;
    const b = bars.get(D); if (!b || b.length < 380) continue;            // yarım gün / eksik veri: atla
    const cD = await chainOf(D), cP = await chainOf(P); if (!cD || !cP) continue;
    const expOf = (j: any, k: number) => etDate(j.expiration[k] * 1000);
    const exps = [...new Set(cD.optionSymbol.map((_: any, k: number) => expOf(cD, k)))].filter((e: any) => e >= D).sort() as string[];
    const dteOf = (e: string) => Math.round((Date.parse(e) - Date.parse(D)) / 864e5);
    const E = exps.find(e => dteOf(e) >= MIN_DTE); if (!E || dteOf(E) > MAX_DTE) continue;
    const pIdx = new Map<string, number>(); cP.optionSymbol.forEach((s: string, k: number) => pIdx.set(s, k));
    const SP = closes.get(P)!, TP = (closeMs(E) - closeMs(P)) / YEAR_MS, SD = closes.get(D)!, TD = (closeMs(E) - closeMs(D)) / YEAR_MS;
    let rows: any[] = [];
    cD.optionSymbol.forEach((sym: string, k: number) => {
      if (expOf(cD, k) !== E) return;
      const type = cD.side[k] === 'put' ? 'put' : 'call', K = cD.strike[k], pk = pIdx.get(sym);
      let iv = NaN, half = NaN, vol = 0, pbid = 0;
      if (pk != null) {
        const bid = cP.bid[pk] ?? 0, ask = cP.ask[pk] ?? 0; vol = cP.volume[pk] ?? 0; pbid = bid;
        const m = bid > 0 && ask >= bid ? (bid + ask) / 2 : 0;
        if (m > 0) { iv = BS.impliedVol(type as any, m, SP, K, TP, R, 0) * Math.sqrt(TP / tauYears(closeMs(P), E)); half = Math.max(0.005, (ask - bid) / 2); }
      }
      const db = cD.bid[k] ?? 0, da = cD.ask[k] ?? 0;
      rows.push({ type, K, oi: cD.openInterest[k] ?? 0, iv: isFinite(iv) && iv > 0.02 && iv < 8 ? +iv.toFixed(4) : null, half: isFinite(half) ? +half.toFixed(3) : null, vol, pbid,
        dMid: db > 0 && da >= db ? +((db + da) / 2).toFixed(3) : null });
    });
    // uygulama varsayılanı strikeLimit=30 gibi: önceki kapanışa en yakın 30 strike
    const strikes = [...new Set(rows.map(r => r.K))].sort((a, b) => Math.abs(a - SP) - Math.abs(b - SP)).slice(0, 30);
    const keep = new Set(strikes); rows = rows.filter(r => keep.has(r.K)).sort((a, b) => a.K - b.K);
    // eksik IV/spread: aynı taraftaki en yakın strike'tan doldur
    for (const r of rows) if (r.iv == null || r.half == null) {
      const nb = rows.filter(x => x.type === r.type && x.iv != null && x.half != null).sort((a, b) => Math.abs(a.K - r.K) - Math.abs(b.K - r.K))[0]
        ?? rows.filter(x => x.iv != null && x.half != null).sort((a, b) => Math.abs(a.K - r.K) - Math.abs(b.K - r.K))[0];
      if (nb) { r.iv ??= nb.iv; r.half ??= nb.half; r.filled = 1; }
    }
    rows = rows.filter(r => r.iv != null);
    if (rows.filter(r => !r.filled).length < 6) continue;
    out.push({ D, P, E, dte: Math.round((Date.parse(E) - Date.parse(D)) / 864e5), SP, SD, TD, bars: b, rows });
  }
  fs.writeFileSync(`${OUT}/${t}.json`, JSON.stringify(out));
  gotAny++; console.log(t, 'gün', out.length, out[0]?.D, out[out.length - 1]?.D);
}
close();
