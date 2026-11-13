/* Backtest çekirdeği: gün kayıtlarını yükle, 5 dk aralıklarla motoru (gerçek signal.ts) çalıştır, opsiyon fiyatını modelle, işlemleri simüle et. */
import fs from 'node:fs';
import * as SG from '../src/lib/odte/signal.ts';
import * as An from '../src/lib/odte/analytics.ts';
import * as BS from '../src/lib/bs.ts';
import { americanPrice, FAST_STEPS } from '../src/lib/american.ts';
import { closeMs, YEAR_MS, isTradingDay, addDaysStr } from '../src/lib/usmarket.ts';
import type { Chain, OptQuote } from '../src/lib/market/types.ts';
import type { Bar } from '../src/lib/odte/analytics.ts';

const NC = !!process.env.BT_NOCOST; // maliyet ayrıştırması: spread/kayma/komisyon sıfır
export const R = 0.04, FEE = NC ? 0 : 1.5, SLIP = NC ? 0 : 0.01, STEP = +(process.env.BT_STEP || 5);
export interface Row { type: 'call' | 'put'; K: number; oi: number; iv: number; half: number; vol: number; dMid: number | null; filled?: number }
export interface Day { ticker: string; D: string; P: string; E: string; dte: number; SP: number; SD: number; TD: number; bars: Bar[]; rows: Row[]; open: number; close: number; pts: Pt[] }
export interface Pt { m: number; t: number; S: number; F: SG.Features; or30: ReturnType<typeof An.openingRange> }
export interface P extends SG.EngineOpts { maxPerDay: number; tickers?: string[] }
export interface Trade { ticker: string; D: string; m: number; dir: 'call' | 'put'; dte: number; K: number; entry: number; exit: number; pnl: number; pct: number; why: 'target' | 'stop' | 'time'; score: number; exitT: number }

const tOf = (d: Day, t: number) => Math.max((closeMs(d.E) - t) / YEAR_MS, 1e-7);
/** İşlem-zamanı varyans saati: seans dakikaları tam, her seans dışı boşluk (gece/hafta sonu) LAMBDA seans sayılır; yıl = 252 seans.
 * Takvim zamanıyla hafta sonu varyansı abartılır (Cuma kapanışı IV'si Pazartesi 0DTE'yi ~%50 ucuz fiyatlar), bu yüzden gerekli. */
export const LAMBDA = +(process.env.BT_LAMBDA || 0.25);
export function tauYears(t: number, E: string): number {
  let mins = 0, gaps = 0;
  const day = new Date(t - 4 * 3600000).toISOString().slice(0, 10); // ET tarihi (yaklaşık; seans saatleri için yeterli)
  const c0 = closeMs(day), o0 = c0 - 6.5 * 3600000;
  if (isTradingDay(day) && t < c0) mins += (c0 - Math.max(t, o0)) / 60000, gaps += t < o0 ? 1 : 0;
  for (let x = addDaysStr(day, 1); x <= E; x = addDaysStr(x, 1)) if (isTradingDay(x)) { gaps++; mins += 390; }
  return Math.max((mins / 390 + LAMBDA * gaps) / 252, 1e-7);
}
/** İşlem-zamanı vol → bu an için eşdeğer takvim IV'si (σc²·Tc = σtt²·τ) */
export const ivAt = (ivtt: number, t: number, E: string) => ivtt * Math.sqrt(tauYears(t, E) / Math.max((closeMs(E) - t) / YEAR_MS, 1e-7));
/** Modellenmiş zincir (tek taraf ya da ikisi): BS fiyat/greek, sabit-strike IV (önceki gün EOD), sabit mutlak yarım spread */
export function snapshot(d: Day, S: number, t: number, side?: 'call' | 'put'): Chain {
  const T = tOf(d, t), k = ivAt(1, t, d.E), calls: OptQuote[] = [], puts: OptQuote[] = [];
  for (const r of d.rows) {
    if (side && r.type !== side) continue;
    if (Math.abs(r.K / S - 1) > 0.15) continue;           // trimChain ile aynı
    const iv = r.iv * k, sq = iv * Math.sqrt(T), d1 = (Math.log(S / r.K) + (R + iv * iv / 2) * T) / sq;
    const m = Math.max(0, BS.price(r.type, S, r.K, T, R, 0, iv));
    const nd = BS.ncdf(d1), delta = r.type === 'call' ? nd : nd - 1, gamma = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) / (S * sq);
    const bid = Math.max(0, +(m - r.half).toFixed(2)), ask = +(m + r.half).toFixed(2);
    const q: OptQuote = { type: r.type, strike: r.K, bid, ask: Math.max(ask, 0.01), last: m, iv, volume: r.vol, oi: r.oi, delta, gamma };
    (r.type === 'call' ? calls : puts).push(q);
  }
  return { expiry: d.E, calls, puts };
}
export function loadDays(tickers: string[], dir = process.env.BT_DAYS || '/workspace/backtest/days'): Day[] {
  const out: Day[] = [];
  for (const tk of tickers) {
    const f = `${dir}/${tk}.json`; if (!fs.existsSync(f)) continue;
    for (const x of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      const bars: Bar[] = x.bars.map((b: number[]) => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
      out.push({ ...x, ticker: tk, bars, open: closeMs(x.D) - 6.5 * 3600000, close: closeMs(x.D), pts: [] });
    }
  }
  return out;
}
/** Parametreden bağımsız göstergeleri 5 dk'da bir önceden hesapla (yalnızca o ana kadar TAMAMLANMIŞ barlar) */
export function precompute(d: Day, mMin = 5, mMax = 360) {
  let n = 0;
  for (let m = mMin; m <= mMax; m += STEP) {
    const t = d.open + m * 60000;
    while (n < d.bars.length && d.bars[n].t + 60000 <= t) n++;
    if (n < 1) continue;
    const bars = d.bars.slice(0, n), S = bars[n - 1].c, ch = snapshot(d, S, t);
    const F = SG.features(S, ch, bars, t, 15);
    const or30 = An.openingRange(F.bars, 30);
    const L = { ...F, bars: { length: F.bars.length } as unknown as Bar[], gx: { net: F.gx.net, flip: F.gx.flip, strikes: [] } };
    d.pts.push({ m, t, S, F: L, or30 });
  }
}
/** decide() ile aynı puan (hızlı ön eleme). Gerekli koşul: |puan| ≥ eşik, hizalı fiyat oyları, güçlü çelişki yok. */
export function fastScore(F: SG.Features, S: number, m: number, W: SG.EngineWeights) {
  let pa = 0, votes = 0, opp: number[] = [];
  const vwd = F.vw != null ? (S > F.vw ? 1 : -1) : 0; if (F.vw != null) { pa += vwd * W.vwap; votes++; }
  let ord = 0; if (F.orng?.complete) { if (S > F.orng.high) ord = 1; else if (S < F.orng.low) ord = -1; if (ord) { pa += ord * W.orb; votes++; } }
  let mod = 0; if (F.mo) { mod = F.mo.ema9 > F.mo.ema21 && F.mo.r5 > 0 ? 1 : F.mo.ema9 < F.mo.ema21 && F.mo.r5 < 0 ? -1 : 0; pa += mod * W.mom; if (mod) votes++; }
  let fl = 0; const ws: number[] = [vwd * W.vwap, ord * W.orb, mod * W.mom];
  if (F.gx.flip != null) { const x = S > F.gx.flip ? W.flip : -W.flip; fl += x; ws.push(x); }
  if (F.w.callWall != null && F.em) { const room = (F.w.callWall - S) / F.em.move; if (room > 0 && room < 0.35) { fl -= W.wall; ws.push(-W.wall); } }
  if (F.w.putWall != null && F.em) { const room = (S - F.w.putWall) / F.em.move; if (room > 0 && room < 0.35) { fl += W.wall; ws.push(W.wall); } }
  if (F.mp != null && m > 270 && F.em && Math.abs(S - F.mp) > 0.25 * F.em.move) { const x = S > F.mp ? -W.maxPain : W.maxPain; fl += x; ws.push(x); }
  if (F.ra.pcVol != null) { const x = F.ra.pcVol < 0.7 ? W.pc : F.ra.pcVol > 1.3 ? -W.pc : 0; fl += x; ws.push(x); }
  if (F.unus.length) { const net = F.unus.reduce((a, u) => a + (u.type === 'call' ? u.vol : -u.vol), 0); const x = net > 0 ? W.unusual : net < 0 ? -W.unusual : 0; fl += x; ws.push(x); }
  const score = +(pa * (F.gx.net < 0 ? W.negGexBoost : 1) + fl).toFixed(2);
  const dir = score > 0 ? 1 : -1;
  const ok = votes >= 2 && Math.sign(pa) === dir && !ws.some(x => Math.sign(x) === -dir && Math.abs(x) >= 1);
  return { score, ok };
}
const snapCache = new Map<string, Chain>();
function snapFor(d: Day, p: Pt, side: 'call' | 'put') {
  const k = d.ticker + d.D + p.m + side; let c = snapCache.get(k);
  if (!c) { c = snapshot(d, p.S, p.t, side); if (snapCache.size > 60000) snapCache.clear(); snapCache.set(k, c); }
  return c;
}
const px = (d: Day, type: 'call' | 'put', K: number, iv: number, S: number, t: number) => americanPrice(type, S, K, tOf(d, t), R, 0, ivAt(iv, t, d.E), [], FAST_STEPS);
/** Tek sinyalin işlem simülasyonu: giriş sonraki barın açılışında ASK (+kayma), çıkış dayanak hedef/stop seviyesinde ya da süre sonunda BID (−kayma) */
export function simulate(d: Day, p: Pt, s: SG.Signal): Trade | null {
  const row = d.rows.find(r => r.type === s.dir && r.K === s.strike); if (!row) return null;
  let k = d.bars.findIndex(b => b.t >= p.t); if (k < 0) return null;
  const b0 = d.bars[k], em = px(d, s.dir, s.strike, row.iv, b0.o, b0.t);
  const H = NC ? 0 : row.half, entry = +(em + H + SLIP).toFixed(2); if (!(em > 0.02)) return null;
  const exitT = d.close - (d.dte === 0 ? 30 : 15) * 60000, call = s.dir === 'call';
  let S = NaN, t = 0, why: Trade['why'] = 'time';
  for (; k < d.bars.length; k++) {
    const b = d.bars[k];
    if (b.t >= exitT) { S = b.o; t = b.t; why = 'time'; break; }
    const stopOpen = call ? b.o <= s.undStop : b.o >= s.undStop, stopHit = call ? b.l <= s.undStop : b.h >= s.undStop;
    const tgtOpen = call ? b.o >= s.undTarget : b.o <= s.undTarget, tgtHit = call ? b.h >= s.undTarget : b.l <= s.undTarget;
    if (stopOpen) { S = b.o; t = b.t; why = 'stop'; break; }
    if (stopHit) { S = s.undStop; t = b.t + 30000; why = 'stop'; break; }   // aynı barda ikisi → stop (muhafazakâr)
    if (tgtOpen) { S = b.o; t = b.t; why = 'target'; break; }
    if (tgtHit) { S = s.undTarget; t = b.t + 30000; why = 'target'; break; }
  }
  if (!isFinite(S)) { const b = d.bars[d.bars.length - 1]; S = b.c; t = b.t + 60000; }
  const xm = px(d, s.dir, s.strike, row.iv, S, t), exit = Math.max(0, +(xm - H - SLIP).toFixed(2));
  const pnl = (exit - entry) * 100 - 2 * FEE;
  return { ticker: d.ticker, D: d.D, m: p.m, dir: s.dir, dte: d.dte, K: s.strike, entry, exit, pnl, pct: pnl / (entry * 100), why, score: s.score, exitT: t };
}
/** Bir parametre setiyle günleri oynat */
export function run(days: Day[], o: P): Trade[] {
  const W = { ...SG.DEFAULT_WEIGHTS, ...(o.w || {}) }, trades: Trade[] = [];
  const startMin = Math.max(o.startMin ?? o.orMinutes, o.orMinutes), endMin = o.endMin ?? 330;
  const en = o.tickers ? new Set(o.tickers) : null;
  for (const d of days) {
    if (en && !en.has(d.ticker)) continue;
    let busy = 0, cnt = 0;
    for (const p of d.pts) {
      if (p.m < startMin || p.m > endMin || p.t < busy || cnt >= o.maxPerDay) continue;
      const F = o.orMinutes === 30 ? { ...p.F, orng: p.or30, orMinutes: 30 } : p.F;
      const fs_ = fastScore(F, p.S, p.m, W);
      if (Math.abs(fs_.score) < o.minScore || !fs_.ok) continue;
      const ch = snapFor(d, p, fs_.score > 0 ? 'call' : 'put');
      const r = SG.decide(d.ticker, p.S, ch, F, p.t, o, { requireOpen: false });
      if (!r.signal) continue;
      const tr = simulate(d, p, r.signal); if (!tr) continue;
      trades.push(tr); busy = tr.exitT + 60000; cnt++;
    }
  }
  return trades;
}
export interface Met { n: number; win: number; avgW: number; avgL: number; exp: number; expPct: number; pf: number; mdd: number; total: number; tstat: number; medPct: number }
export function metrics(ts: Trade[]): Met {
  const n = ts.length; if (!n) return { n: 0, win: NaN, avgW: NaN, avgL: NaN, exp: NaN, expPct: NaN, pf: NaN, mdd: 0, total: 0, tstat: NaN, medPct: NaN };
  const w = ts.filter(x => x.pnl > 0), l = ts.filter(x => x.pnl <= 0);
  const gw = w.reduce((a, x) => a + x.pnl, 0), gl = -l.reduce((a, x) => a + x.pnl, 0), total = gw - gl;
  let eq = 0, pk = 0, mdd = 0; for (const x of [...ts].sort((a, b) => a.exitT - b.exitT)) { eq += x.pnl; pk = Math.max(pk, eq); mdd = Math.max(mdd, pk - eq); }
  const pcts = ts.map(x => x.pct), mp = pcts.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(pcts.reduce((a, b) => a + (b - mp) ** 2, 0) / Math.max(1, n - 1));
  const sp = [...pcts].sort((a, b) => a - b);
  return { n, win: w.length / n, avgW: w.length ? gw / w.length : 0, avgL: l.length ? -gl / l.length : 0, exp: total / n, expPct: mp, pf: gl > 0 ? gw / gl : Infinity, mdd, total, tstat: sd > 0 ? mp / sd * Math.sqrt(n) : 0, medPct: sp[Math.floor(n / 2)] };
}
export const group = <K extends string | number>(ts: Trade[], f: (t: Trade) => K) => { const m = new Map<K, Trade[]>(); for (const t of ts) { const k = f(t); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); } return m; };
