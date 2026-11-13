/* Adım 1 + 2: taban backtest, rastgele arama + komşu sağlamlığı, eğitim/test (ilk %70 / son %30 gün), hisse seçimi. Çıktı: /workspace/backtest/results.json */
import fs from 'node:fs';
import * as SG from '../src/lib/odte/signal.ts';
import { loadDays, precompute, run, metrics, group, fastScore, snapshot, type Day, type P, type Trade, type Met } from './bt.mts';
import { TICKERS } from './common.mts';
import { Worker } from 'node:worker_threads';
import os from 'node:os';

const t0 = Date.now();
const days = loadDays(TICKERS);
for (const d of days) precompute(d);
console.error('ön hesap', days.length, 'gün-hisse', ((Date.now() - t0) / 1000).toFixed(0) + ' sn');
const dates = [...new Set(days.map(d => d.D))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];
const train = days.filter(d => d.D < cut), test = days.filter(d => d.D >= cut);
console.error('tarih', dates[0], '→', dates[dates.length - 1], 'eğitim <', cut, 'gün', dates.length);

// fastScore doğrulama: decide() puanı ile birebir aynı mı (örnek)
{
  let n = 0, bad = 0;
  for (const d of days.filter((_, i) => i % 37 === 0)) for (const p of d.pts) {
    const r = SG.decide(d.ticker, p.S, snapshot(d, p.S, p.t), p.F, p.t, SG.V1_OPTS, { requireOpen: false });
    const f = fastScore(p.F, p.S, p.m, SG.DEFAULT_WEIGHTS); n++;
    if (Math.abs(r.score - f.score) > 1e-9) bad++;
    if (r.signal && !f.ok) bad++;
  }
  console.error('fastScore doğrulama', n, 'nokta, uyumsuz', bad);
  if (bad) throw new Error('fastScore uyumsuz');
}
const BASE: P = { ...SG.V1_OPTS, maxPerDay: 99 };
// arama uzayı
const SP = {
  minScore: [2, 2.5, 3, 3.5, 4, 4.5, 5], minRR: [1, 1.25, 1.5, 2, 2.5], maxSpread: [0.05, 0.08, 0.12, 0.2],
  liq: [[0, 0], [100, 300], [300, 1000], [1000, 3000]], orMinutes: [15, 30], startMin: [15, 30, 45, 60, 90], endMin: [180, 240, 300, 330, 360],
  vwap: [0.5, 1, 1.5], orb: [0.5, 1, 1.5, 2], mom: [0.5, 1, 1.5], flip: [0, 0.5, 1], wall: [0, 0.5, 1], maxPain: [0, 0.5, 1], pc: [0, 0.5, 1], unusual: [0, 0.5, 1],
  negGexBoost: [1, 1.2, 1.5], tgtEm: [0.3, 0.4, 0.5, 0.7, 1], stopMinEm: [0.05, 0.1, 0.15], stopMaxEm: [0.2, 0.25, 0.35, 0.5], targetDelta: [0.3, 0.4, 0.45, 0.5, 0.6], maxPerDay: [1, 2, 99],
} as const;
type Key = keyof typeof SP; const KEYS = Object.keys(SP) as Key[];
type G = Record<Key, number>;  // indeks vektörü
const toP = (g: G): P => {
  const v = (k: Key) => (SP[k] as readonly any[])[g[k]];
  const or = v('orMinutes'), liq = v('liq');
  return { minScore: v('minScore'), minRR: v('minRR'), maxSpread: v('maxSpread'), minVol: liq[0], minOI: liq[1], orMinutes: or, startMin: Math.max(or, v('startMin')), endMin: v('endMin'),
    w: { vwap: v('vwap'), orb: v('orb'), mom: v('mom'), flip: v('flip'), wall: v('wall'), maxPain: v('maxPain'), pc: v('pc'), unusual: v('unusual'), negGexBoost: v('negGexBoost') },
    tgtEm: v('tgtEm'), stopMinEm: v('stopMinEm'), stopMaxEm: v('stopMaxEm'), targetDelta: v('targetDelta'), maxPerDay: v('maxPerDay') };
};
const idx = (k: Key, val: any) => (SP[k] as readonly any[]).findIndex(x => JSON.stringify(x) === JSON.stringify(val));
const BASEG = { minScore: idx('minScore', 3), minRR: idx('minRR', 1.5), maxSpread: idx('maxSpread', 0.12), liq: 1, orMinutes: 0, startMin: 0, endMin: idx('endMin', 330), vwap: 1, orb: 2, mom: 1, flip: 1, wall: 1, maxPain: 1, pc: 1, unusual: 1,
  negGexBoost: 1, tgtEm: 2, stopMinEm: 1, stopMaxEm: 2, targetDelta: 2, maxPerDay: 2 } as G;
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const MIN_N = 120;
const obj = (m: Met) => m.n < MIN_N ? -99 : m.tstat;   // amaç: işlem başı % getirinin t-istatistiği (beklenti × tutarlılık)
const cacheEval = new Map<string, Met>();
// işçi havuzu
const NW = Math.max(1, Math.min(+(process.env.BT_WORKERS || 6), os.cpus().length - 1));
const workers: Worker[] = []; const pend = new Map<number, (m: Met) => void>(); let wid = 0, rr = 0;
await Promise.all(Array.from({ length: NW }, () => new Promise<void>(res => {
  const w = new Worker(new URL('./worker.mts', import.meta.url), { workerData: { tickers: TICKERS, cut } });
  w.on('message', (msg: any) => { if (msg.ready) return res(); pend.get(msg.id)!(msg.m); pend.delete(msg.id); });
  w.on('error', e => { console.error('işçi hatası', e); process.exit(1); });
  workers.push(w);
})));
console.error('işçiler hazır', NW);
const remote = (p: P, set: 'train' | 'test') => new Promise<Met>(res => { const id = ++wid; pend.set(id, res); workers[rr++ % NW].postMessage({ id, p, set }); });
const evalMany = async (gs: G[], set: 'train' | 'test' = 'train') => {
  const out = await Promise.all(gs.map(async g => { const k = set + JSON.stringify(g); let m = cacheEval.get(k); if (!m) { m = await remote(toP(g), set); cacheEval.set(k, m); } return m; }));
  return out;
};
const evalG = (g: G) => cacheEval.get('train' + JSON.stringify(g))!;

const baseTr = metrics(run(train, BASE)), baseTe = metrics(run(test, BASE));
console.error('TABAN eğitim', JSON.stringify(baseTr), '\nTABAN test', JSON.stringify(baseTe));
const N = +(process.env.BT_N || 1200);
const cands: { g: G; m: Met }[] = [];
const t1 = Date.now();
console.error('işçi testi', JSON.stringify(await remote(BASE, 'train')));
const gsAll: G[] = [];
for (let i = 0; i < N; i++) {
  const g = {} as G; for (const k of KEYS) g[k] = Math.floor(rnd() * SP[k].length);
  if (i < 100) for (const k of KEYS) if (rnd() < 0.6) g[k] = BASEG[k];          // ilk örnekler tabana yakın
  gsAll.push(g);
}
for (let i = 0; i < N; i += 60) {
  const gs = gsAll.slice(i, i + 60), ms = await evalMany(gs); gs.forEach((g, j) => cands.push({ g, m: ms[j] }));
  console.error('arama', Math.min(N, i + 60), ((Date.now() - t1) / 1000).toFixed(0) + ' sn', 'en iyi', Math.max(...cands.map(c => obj(c.m))).toFixed(2));
}
// koordinat inişi (en iyi 5'ten)
const neighbors = (g: G) => { const out: G[] = []; for (const k of KEYS) for (const dlt of [-1, 1]) { const j = g[k] + dlt; if (j >= 0 && j < SP[k].length) out.push({ ...g, [k]: j }); } return out; };
const top = [...cands].sort((a, b) => obj(b.m) - obj(a.m)).slice(0, 5);
for (const c of top) {
  let g = c.g, best = obj(c.m);
  for (let it = 0; it < 4; it++) {
    let improved = false;
    const nbs = neighbors(g), ms = await evalMany(nbs); let bg = g;
    nbs.forEach((nb, j) => { cands.push({ g: nb, m: ms[j] }); if (obj(ms[j]) > best + 1e-9) { best = obj(ms[j]); bg = nb; improved = true; } }); g = bg;
    if (!improved) break;
  }
}
// sağlamlık: komşuların medyanı
const uniq = new Map<string, { g: G; m: Met }>(); for (const c of cands) uniq.set(JSON.stringify(c.g), c);
const top25 = [...uniq.values()].filter(c => c.m.n >= MIN_N).sort((a, b) => obj(b.m) - obj(a.m)).slice(0, 25);
await evalMany(top25.flatMap(c => neighbors(c.g)));
const ranked = top25.map(c => {
  const nb = neighbors(c.g).map(g => obj(evalG(g))).sort((a, b) => a - b);
  const med = nb[Math.floor(nb.length / 2)], p25 = nb[Math.floor(nb.length / 4)];
  return { ...c, med, p25, robust: Math.min(obj(c.m), med) };
}).sort((a, b) => b.robust - a.robust);
const pick = ranked[0];
const optP = toP(pick.g);
const optTr = metrics(run(train, optP)), optTe = metrics(run(test, optP));
console.error('OPT', JSON.stringify(optP), '\nOPT eğitim', JSON.stringify(optTr), '\nOPT test', JSON.stringify(optTe));
// hisse seçimi: yalnızca EĞİTİM verisiyle (n ≥ 10 ve beklenti < 0 → çıkar)
const trTrades = run(train, optP), byT = group(trTrades, t => t.ticker);
const keep = TICKERS.filter(t => { const ts = byT.get(t); if (!ts) return false; const m = metrics(ts); return !(m.n >= 10 && m.expPct < 0) && m.n >= 3; });
const finP: P = { ...optP, tickers: keep };
const finTr = metrics(run(train, finP)), finTe = metrics(run(test, finP));
console.error('SEÇİLİ hisseler', keep.join(','), '\nFIN eğitim', JSON.stringify(finTr), '\nFIN test', JSON.stringify(finTe));
// raporlama
const all = (p: P) => run(days, p);
const breakdown = (ts: Trade[]) => {
  const etH = (m: number) => { const t = 570 + m; const h = Math.floor(t / 60), mm = t % 60 < 30 ? '00' : '30'; return `${String(h).padStart(2, '0')}:${mm}`; };
  const f = (g: Map<any, Trade[]>) => [...g.entries()].map(([k, v]) => ({ k, ...metrics(v) })).sort((a, b) => String(a.k).localeCompare(String(b.k)));
  return { ticker: f(group(ts, t => t.ticker)), tod: f(group(ts, t => etH(t.m))), dir: f(group(ts, t => t.dir)), dte: f(group(ts, t => t.dte === 0 ? '0' : t.dte === 1 ? '1' : t.dte <= 3 ? '2-3' : '4+')), why: f(group(ts, t => t.why)) };
};
const curve = (ts: Trade[]) => { const byD = group(ts, t => t.D); let eq = 0; return dates.map(D => { for (const t of byD.get(D) ?? []) eq += t.pnl; return { D, eq: +eq.toFixed(2) }; }); };
const split = (ts: Trade[]) => ({ train: metrics(ts.filter(t => t.D < cut)), test: metrics(ts.filter(t => t.D >= cut)) });
const baseAll = all(BASE), optAll = all(optP), finAll = all(finP);
const res = {
  generated: new Date().toISOString(), dates: { first: dates[0], last: dates[dates.length - 1], n: dates.length, cut, trainDays: dates.filter(d => d < cut).length, testDays: dates.filter(d => d >= cut).length },
  dayTickers: days.length, perTickerDays: Object.fromEntries(TICKERS.map(t => [t, days.filter(d => d.ticker === t).length])),
  dteDays: Object.fromEntries([...group(days as any[], (d: any) => d.dte === 0 ? '0' : d.dte === 1 ? '1' : d.dte <= 3 ? '2-3' : '4+')].map(([k, v]) => [k, v.length])),
  searched: uniq.size, minN: MIN_N,
  base: { p: BASE, ...split(baseAll), br: breakdown(baseAll), brTest: breakdown(baseAll.filter(t => t.D >= cut)), curve: curve(baseAll) },
  opt: { p: optP, ...split(optAll), br: breakdown(optAll), brTrain: breakdown(optAll.filter(t => t.D < cut)), brTest: breakdown(optAll.filter(t => t.D >= cut)), curve: curve(optAll), med: pick.med, p25: pick.p25 },
  fin: { p: finP, keep, ...split(finAll), br: breakdown(finAll), brTest: breakdown(finAll.filter(t => t.D >= cut)), curve: curve(finAll) },
  top: ranked.slice(0, 10).map(r => ({ p: toP(r.g), train: r.m, test: metrics(run(test, toP(r.g))), med: r.med, p25: r.p25 })),
  searchCloud: [...uniq.values()].filter(c => c.m.n >= 30).map(c => ({ n: c.m.n, e: +c.m.expPct.toFixed(4), t: +c.m.tstat.toFixed(2) })),
  trades: { base: baseAll, fin: finAll },
};
fs.writeFileSync('/workspace/backtest/results.json', JSON.stringify(res));
console.error('bitti', ((Date.now() - t0) / 1000).toFixed(0) + ' sn');
for (const w of workers) w.terminate();
