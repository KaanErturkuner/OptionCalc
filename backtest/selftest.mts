/* Backtest altyapısı öz-testi — gerçek veri GEREKMEZ (sentetik gün). `npm run bt:selftest`
 * Kontroller: tüm stratejiler hatasız çalışır; ORB stratejisi sentetik trend gününde tetiklenir; hybrid kaynak kayıtlı anlık görüntüyü
 * kullanır (src='real') ve modelle aynı fiyatlarda aynı sonucu verir; walk-forward katmanları sızıntısız; bütçe tahmini mantıklı. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-selftest-')); process.env.BT_SNAPS = tmp;
const { precompute, snapshot } = await import('./bt.mts');
const { runStrategy, xmetrics } = await import('./engine.mts');
const { makeSource } = await import('./sources.mts');
const { makeFolds, sampleParams } = await import('./wf.mts');
const { estimateCredits } = await import('./md.mts');
const { STRATEGIES, strategyById } = await import('../src/lib/odte/strategies/index.ts');
const { closeMs } = await import('../src/lib/usmarket.ts');
let fail = 0; const ok = (name: string, c: boolean, extra = '') => { if (!c) fail++; console.log((c ? 'OK   ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };

function synthDay(D: string, drift: number, seed: number) {
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const open = closeMs(D) - 6.5 * 3600000, bars: any[] = []; let px = 500;
  for (let i = 0; i < 390; i++) { const o = px; px = px * (1 + drift + (rnd() - 0.5) * 0.0016); const h = Math.max(o, px) * (1 + rnd() * 3e-4), l = Math.min(o, px) * (1 - rnd() * 3e-4);
    bars.push({ t: open + i * 60000, o, h, l, c: px, v: 1e5 * (i < 15 ? 3 : 1) * (0.5 + rnd()) }); }
  const rows: any[] = []; for (let K = 470; K <= 530; K++) for (const type of ['call', 'put']) rows.push({ type, K, oi: 1000 + (K === 510 && type === 'call' ? 20000 : 0) + (K === 490 && type === 'put' ? 20000 : 0), iv: 0.18, half: 0.02, vol: 500, dMid: null });
  const d: any = { ticker: 'SYN', D, P: D, E: D, dte: 0, SP: 499, SD: px, TD: 0, bars, rows, open, close: closeMs(D), pts: [] };
  precompute(d); return d;
}
const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'].map((D, i) => synthDay(D, i % 2 ? 0.00012 : -0.00012, 11 + i));
ok('sentetik günler hazır', days.every(d => d.pts.length > 50), `${days.length} gün × ${days[0].pts.length} nokta`);
const src = makeSource('modeled');
for (const s of STRATEGIES) {
  let tr: any[] = [], err = '';
  try { tr = runStrategy(days, s, s.defaults, { source: src }); } catch (e) { err = (e as Error).stack || String(e); }
  ok(`strateji çalışır: ${s.id}`, !err && tr.every(t => isFinite(t.pnl) && t.entry > 0), err ? err.split('\n')[0] : `${tr.length} işlem`);
}
const orb = strategyById('orb-vwap')!, orbT = runStrategy(days, orb, { ...orb.defaults, volMult: 0 }, { source: src });
ok('orb-vwap trend günlerinde tetiklenir', orbT.length >= 3, `${orbT.length} işlem`);
// hybrid: model fiyatlarıyla aynı anlık görüntüler yaz → aynı işlemler, src='real'
const d0 = days[1]; fs.mkdirSync(path.join(tmp, d0.D), { recursive: true });
const lines: string[] = [];
for (let i = 0; i < d0.bars.length; i += 1) {
  const b = d0.bars[i], t = b.t + 60000, ch = snapshot(d0, b.c, t);
  const rows = [...ch.calls, ...ch.puts].map(q => [q.type === 'put' ? 1 : 0, q.strike, q.bid, q.ask, q.iv ?? 0, q.delta ?? 0, q.gamma ?? 0, q.volume, q.oi]);
  lines.push(JSON.stringify({ t, rt: t, S: b.c, E: d0.E, rows }));
}
fs.writeFileSync(path.join(tmp, d0.D, 'SYN.jsonl'), lines.join('\n'));
const hyb = makeSource('hybrid'), p0 = { ...orb.defaults, volMult: 0 };
const a = runStrategy([d0], orb, p0, { source: src }), b = runStrategy([d0], orb, p0, { source: hyb });
ok('hybrid kayıtlı kotu kullanır', b.length > 0 && b.every(t => t.src === 'real'), `${b.length} işlem, src=${b.map(t => t.src).join(',')}`);
ok('hybrid ≈ model (aynı fiyatlar)', a.length === b.length && a.every((t, i) => Math.abs(t.pct - b[i].pct) < 0.25), a.map((t, i) => `${t.pct.toFixed(2)}/${b[i]?.pct.toFixed(2)}`).join(' '));
ok('kaydı olmayan gün → model yedeği', runStrategy([days[2]], orb, p0, { source: hyb }).every(t => t.src === 'model'));
const fs4 = makeFolds(days.map(d => d.D), 3, 0.4);
ok('walk-forward katmanları sızıntısız', fs4.length === 3 && fs4.every(f => f.trainTo < f.testFrom && f.testFrom <= f.testTo), JSON.stringify(fs4.map(f => [f.trainTo, f.testFrom, f.testTo])));
ok('parametre örnekleme tekil + varsayılan ilk', (() => { const ps = sampleParams(orb, 20); return JSON.stringify(ps[0]) === JSON.stringify(orb.defaults) && new Set(ps.map(p => JSON.stringify(p))).size === ps.length; })());
const m = xmetrics(orbT); ok('metrikler (GA, Sharpe) sonlu', isFinite(m.expPct) && (m.n < 5 || m.ci95[0] <= m.expPct && m.expPct <= m.ci95[1]), JSON.stringify({ n: m.n, e: m.expPct, ci: m.ci95 }));
ok('kredi tahmini: cached=1, geçmiş zincir=1, 1 ay 1 dk mum≈9', estimateCredits('/options/chain/SPY/?mode=cached') === 1 && estimateCredits('/options/chain/SPY/?date=2026-01-02&from=x') === 1
  && Math.abs(estimateCredits('/stocks/candles/1/SPY/?from=2026-01-01&to=2026-02-01') - 9) <= 1);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} HATA` : '\nBacktest öz-testi geçti'); process.exit(fail ? 1 : 0);
