/*
 * Aşama 6 (SINYAL-FIRSAT §9): Fırsat setupları (firsat-s1..s6) — walk-forward (5 kat, ilk %40 seçim dönemi) + OOS işlemlerin
 * kâğıt hesap replay'i ($300, Kaan D12 kuralları) + gün bloklu Monte Carlo (20/60 işlem günü).
 * YALNIZCA çevrimdışı veri: BT_OFFLINE=1 (MarketData'ya bağlanılmaz, token okunmaz). Yardımcı semboller önbellekten; ^VIX günlük (Yahoo).
 *
 *   BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/firsat.mts [--out DIR] [--n 60] [--folds 5] [--paths 10000]
 * Çıktı: <out>/report.json, <out>/tables.md
 *
 * Kurallar (D12): birincil hedef 1:5 (risk bazlı, +5R), yedek 1:4 (MC varyantı), prim stopu %67, komisyon $1,50/kontrat/yön,
 * 15:45 ET kapanış (gece taşıma yalnız takvim kapısından geçerse — bkz. kapı sayımı), DURDU açık, kademe 50/40/30, güvenli modda 1:2.
 * Modelleme: fiyatlar önceki gün EOD IV ile modellenir (--source modeled); gerçek gün içi kot yok. Setup'lar peer/VIX kullanmaz (A1 yalnız kendi VWAP'ı).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDays, precompute, type Day } from './bt.mts';
import { runStrategy, type ETrade } from './engine.mts';
import { walkForward } from './wf.mts';
import { defaultCosts, makeSource } from './sources.mts';
import { loadPeers } from './peers.mts';
import { START, END } from './common.mts';
import { toPath, pct, f2, usd } from './tables-common.mts';
import { firsatStrategies } from '../src/lib/odte/strategies/firsat.ts';
import { replayTrades, runPathMc, rSummary, bootstrapMeanCiLo, rUnder, type PathTrade } from '../src/lib/paper/path.ts';
import { backtestVerdict } from '../src/lib/signals/criteria.ts';
import { calendarCheck, isEtf, type EarningsInfo } from '../src/lib/calendar/events.ts';
import { addDaysStr, isTradingDay } from '../src/lib/usmarket.ts';

const A = process.argv.slice(2), arg = (k: string, d?: string) => { const i = A.indexOf('--' + k); return i >= 0 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
if (!process.env.BT_OFFLINE) { console.error('BT_OFFLINE=1 gerekli (bu koşu yalnız önbellek ve yerel gün dosyalarıyla çalışır).'); process.exit(1); }
if (process.env.MARKETDATA_TOKEN) { console.error('MARKETDATA_TOKEN ortamda olmamalı (çevrimdışı koşu). `unset MARKETDATA_TOKEN` çalıştırın.'); process.exit(1); }
const outDir = arg('out', '/workspace/backtest/reports/asama-6')!;
const nS = +arg('n', '60')!, folds = +arg('folds', '5')!, paths = +arg('paths', '10000')!;
const TICK = ['QQQ', 'GLD', 'SLV', 'NVDA'];
const GROUPS = [
  { id: '0DTE', dir: arg('days0', '/workspace/backtest/days')! },
  { id: '1–3 DTE', dir: arg('days13', '/workspace/backtest/days-dte13')! },
];
const KAAN = { targetN: 5 };
const START_CAP = 300;
const PEER_SYMS = ['SPY', 'SMH', 'UUP', 'TLT', 'GDX', 'SIL', 'QQQ', 'GLD', '^VIX'];
const t0 = Date.now();

const costs = defaultCosts(), c15 = { ...costs, spreadMult: 1.5 };
const src = makeSource('modeled', costs), src15 = makeSource('modeled', c15);
const peers = await loadPeers(PEER_SYMS, START, END);
console.error('yardımcı kapsam (gün):', JSON.stringify(peers.cover));

const groups = GROUPS.map(g => {
  const days: Day[] = loadDays(TICK, g.dir);
  for (const d of days) precompute(d);
  return { ...g, days, dates: [...new Set(days.map(d => d.D))].sort() };
});
for (const g of groups) console.error(`${g.id}: ${g.days.length} hisse-gün, ${g.dates[0]} → ${g.dates[g.dates.length - 1]}`);

/* ——— 1) walk-forward + IS + spread×1,5 ——— */
interface SetupRun { group: string; id: string; name: string; folds: any[]; is: ETrade[]; oos: ETrade[]; oos15: ETrade[]; defaults: any; foldTest: [string, string][] }
const runs: SetupRun[] = [];
for (const g of groups) {
  const isEnd = g.dates[Math.floor(g.dates.length * 0.4) - 1];
  for (const s of firsatStrategies) {
    const ts = Date.now();
    const wf = walkForward(g.days, s, { source: src, costs, peers: peers.get, kaan: KAAN, k: folds, n: nS, trainFrac: 0.4 });
    const is = runStrategy(g.days.filter(d => d.D <= isEnd), s, s.defaults, { source: src, costs, peers: peers.get, kaan: KAAN });
    const oos15 = wf.folds.flatMap(f => runStrategy(g.days.filter(d => d.D >= f.testFrom && d.D <= f.testTo), s, f.best, { source: src15, costs: c15, peers: peers.get, kaan: KAAN }));
    runs.push({ group: g.id, id: s.id, name: s.name, defaults: s.defaults,
      folds: wf.folds.map(f => ({ trainFrom: f.trainFrom, trainTo: f.trainTo, testFrom: f.testFrom, testTo: f.testTo, best: f.best, trainN: f.train.n, testN: f.test.n, evaluated: f.evaluated })),
      is, oos: wf.oos, oos15, foldTest: wf.folds.map(f => [f.testFrom, f.testTo] as [string, string]) });
    console.error(`${g.id} ${s.id}: IS n=${is.length} · OOS n=${wf.oos.length} · ${Math.round((Date.now() - ts) / 1000)} sn`);
  }
}

/* ——— 2) gece taşıma kapısı (1–3 DTE): takvim verisi kapsamı ———
 * Earnings: ETF'lerde yok (etf); hisse (NVDA) için çevrimdışı bilanço verisi YOK → "bilinmiyor" (taşıma yok). */
const nextTD = (d: string) => { let x = addDaysStr(d, 1); while (!isTradingDay(x)) x = addDaysStr(x, 1); return x; };
/** Bilanço bilgisi: ETF → etf; NVDA → backtest/aux/earnings-NVDA.json yalnız complete=true ise sorgulanır, değilse "bilinmiyor" (taşıma yok). */
const EARN_FILE = '/workspace/backtest/aux/earnings-NVDA.json';
function earningsInfoFor(tk: string, D: string, nextD: string): EarningsInfo {
  if (isEtf(tk)) return { kind: 'etf' };
  if (tk !== 'NVDA' || !fs.existsSync(EARN_FILE)) return { kind: 'bilinmiyor' };
  const e = JSON.parse(fs.readFileSync(EARN_FILE, 'utf8'));
  if (e.complete !== true) return { kind: 'bilinmiyor' };
  const hit = (e.dates ?? []).find((x: string) => x >= D && x <= nextD);
  return hit ? { kind: 'var', date: hit } : { kind: 'yok' };
}
const gateRows: Record<string, { days: number; pass: number; earn: string }> = {};
const oos13 = runs.filter(r => r.group === '1–3 DTE').flatMap(r => r.oos);
const gateDays = new Map<string, Set<string>>();
for (const t of oos13) { const k = t.ticker; if (!gateDays.has(k)) gateDays.set(k, new Set()); gateDays.get(k)!.add(t.D); }
for (const [tk, ds] of gateDays) {
  let pass = 0; const kinds = new Set<string>();
  for (const D of ds) { const earn = earningsInfoFor(tk, D, nextTD(D)); kinds.add(earn.kind); if (calendarCheck(D, nextTD(D), earn).ok) pass++; }
  gateRows[tk] = { days: ds.size, pass, earn: [...kinds].join(',') };
}

/* ——— 3) PathTrade dönüşümü, ticker × grup replay ——— */

interface Row { group: string; ticker: string; n: number; win: number; avgR: number; pf: number; ciLo: number; spreadR: number; taken: number; busy: number; durdu: number; noCap: number; final: number; maxDd: number; ret: number; ruined: boolean }
const rows: Row[] = [];
interface IsRow { group: string; ticker: string; isN: number; isWin: number; isAvgR: number; isTaken: number; isFinal: number; isMaxDd: number; oosN: number; oosWin: number; oosAvgR: number; oosTaken: number; oosFinal: number; oosMaxDd: number }
const isRows: IsRow[] = [];
const medFill: Record<string, number> = {};
const setupRows: any[] = [];
const replayByGroup: Record<string, { final: number; maxDd: number; taken: number; pathsAll: PathTrade[] }> = {};
const mcSets: Record<string, PathTrade[][]> = {};
for (const g of groups) {
  const gr = runs.filter(r => r.group === g.id);
  const pool = gr.flatMap(r => r.oos), poolP = pool.map(toPath);
  const pool15 = gr.flatMap(r => r.oos15);
  for (const tk of [...TICK, 'Tümü']) {
    const sel = (t: { ticker: string }) => tk === 'Tümü' || t.ticker === tk;
    const tr = pool.filter(sel), tr15 = pool15.filter(sel);
    const R5 = tr.map(t => rUnder(toPath(t), 5)), sm = rSummary(R5), sm15 = rSummary(tr15.map(t => rUnder(toPath(t), 5)));
    const rp = replayTrades(poolP.filter(p => tk === 'Tümü' || p.ticker === tk), { startCapital: START_CAP });
    rows.push({ group: g.id, ticker: tk, n: tr.length, win: sm.win, avgR: sm.avg, pf: sm.pf, ciLo: bootstrapMeanCiLo(R5), spreadR: sm15.avg,
      taken: rp.taken, busy: rp.busy, durdu: rp.durdu, noCap: rp.noCapital, final: rp.final, maxDd: rp.maxDd, ret: rp.final / START_CAP - 1, ruined: rp.ruined });
    // [grok] IS (seçim dönemi, varsayılan parametre) replay'i — OOS ile aynı para yönetimi, yan yana karşılaştırma için.
    const isTr = gr.flatMap(r => r.is).filter(sel), isP = isTr.map(toPath), smIs = rSummary(isP.map(p => rUnder(p, 5)));
    const rpIs = replayTrades(isP, { startCapital: START_CAP });
    isRows.push({ group: g.id, ticker: tk, isN: isTr.length, isWin: smIs.win, isAvgR: smIs.avg, isTaken: rpIs.taken, isFinal: rpIs.final, isMaxDd: rpIs.maxDd,
      oosN: tr.length, oosWin: sm.win, oosAvgR: sm.avg, oosTaken: rp.taken, oosFinal: rp.final, oosMaxDd: rp.maxDd });
  }
  for (const s of gr) for (const tk of TICK) {
    const tr = s.oos.filter(t => t.ticker === tk), tr15 = s.oos15.filter(t => t.ticker === tk);
    const R5 = tr.map(t => rUnder(toPath(t), 5)), sm = rSummary(R5), sm15 = rSummary(tr15.map(t => rUnder(toPath(t), 5)));
    const ci = bootstrapMeanCiLo(R5);
    const verdict = backtestVerdict({ n: sm.n, expR: sm.avg, pf: sm.pf, ciLo: ci, expRSpread15: sm15.avg });
    setupRows.push({ group: g.id, setup: s.id, ticker: tk, n: sm.n, win: sm.win, avgR: sm.avg, pf: sm.pf, ciLo: ci, spreadR: sm15.avg, verdict: verdict.verdict, failed: verdict.failed,
      isN: s.is.filter(t => t.ticker === tk).length, isAvgR: rSummary(s.is.filter(t => t.ticker === tk).map(t => rUnder(toPath(t), 5))).avg });
  }
  replayByGroup[g.id] = { final: 0, maxDd: 0, taken: 0, pathsAll: poolP };
  // MC günleri: OOS test aralıklarındaki tüm işlem günleri (işlemsiz günler dâhil)
  const testDates = g.dates.filter(D => gr[0].foldTest.some(([a, b]) => D >= a && D <= b));
  const byDay = new Map<string, PathTrade[]>();
  for (const D of testDates) byDay.set(D, []);
  for (const p of poolP) byDay.get(p.D)?.push(p);
  mcSets[g.id] = [...byDay.values()];
  { const fs_ = poolP.map(p => p.fill).sort((a, b) => a - b); medFill[g.id] = fs_.length ? fs_[Math.floor(fs_.length / 2)] : NaN; }
}

const variants = [
  { id: 'birincil', label: 'Birincil: 1:5 (AGRESIF) / 1:2 (güvenli), DURDU açık, tam kontrat', policy: { agresif: 5, safe: 2 }, settings: {} },
  { id: 'yedek14', label: 'Yedek karşılaştırma: AGRESIF 1:4, güvenli 1:2', policy: { agresif: 4, safe: 2 }, settings: {} },
  { id: 'hedef12', label: '[grok] Hedef 1:2 sabit (tüm modlar)', policy: { agresif: 2, safe: 2 }, settings: {} },
  { id: 'hedef115', label: '[grok] Hedef 1:1,5 sabit (tüm modlar)', policy: { agresif: 1.5, safe: 1.5 }, settings: {} },
  { id: 'durdu-kapali', label: 'Karşılaştırma: DURDU kapalı', policy: { agresif: 5, safe: 2 }, settings: { durduEnabled: false } },
  { id: 'kesirli', label: 'Bilgi amaçlı: kesirli kontrat (Kaan kuralı DEĞİL)', policy: { agresif: 5, safe: 2 }, settings: { fractional: true } },
];
const mc: any[] = [];
for (const g of groups) for (const v of variants) {
  const st = runPathMc(mcSets[g.id], { startCapital: START_CAP, horizons: [20, 60], paths, seed: 20261113, policy: v.policy, settings: v.settings,
    stuckBelow: (medFill[g.id] * 100 + 1.5) / 0.5 });   // %50 kademeyle medyan OOS dolumunda 1 kontrat alınamıyor
  for (const s of st) mc.push({ group: g.id, variant: v.id, label: v.label, ...s });
  if (v.id === 'birincil') {
    const rp = replayTrades(replayByGroup[g.id].pathsAll, { startCapital: START_CAP, policy: v.policy, settings: v.settings });
    replayByGroup[g.id].final = rp.final; replayByGroup[g.id].maxDd = rp.maxDd; replayByGroup[g.id].taken = rp.taken;
  }
}

/* ——— 4) çıktılar ——— */
const days = Object.fromEntries(groups.map(g => [g.id, g.days.length]));
const report = { generated: new Date().toISOString(), window: { start: START, end: END }, costs, c15, folds, samples: nS, paths, startCapital: START_CAP,
  peerCover: peers.cover, days, gateRows, runs: runs.map(r => ({ ...r, is: r.is.length, oos: r.oos })), rows, isRows, medFill, setupRows, mc };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...report, runs: undefined, setupRowsCount: setupRows.length }, null, 1));
fs.writeFileSync(path.join(outDir, 'runs.json'), JSON.stringify(report.runs.map(r => ({ group: r.group, id: r.id, folds: r.folds, is: r.is, oos: r.oos.length }))));

const md: string[] = [];
md.push('# Aşama 6 tabloları (otomatik)', '', `Pencere: ${START} → ${END} · maliyet: $${costs.fee}/kontrat/yön, kayma $${costs.slip}, spread ×${costs.spreadMult} · walk-forward ${folds} kat, ${nS} parametre seti, ilk %40 seçim · MC ${paths} yol`, '');
md.push('## Ticker × grup (OOS; replay $300)', '', '| Grup | Ticker | Sinyal n | Kazanma (R>0) | Ort. R | PF(R) | GA alt (R) | Spread×1,5 ort. R | Alınan n | Meşgul | DURDU | Yetersiz sermaye | Nihai | Maks. düşüş | Getiri |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) md.push(`| ${r.group} | ${r.ticker} | ${r.n} | ${pct(r.win)} | ${f2(r.avgR)} | ${f2(r.pf)} | ${f2(r.ciLo)} | ${f2(r.spreadR)} | ${r.taken} | ${r.busy} | ${r.durdu} | ${r.noCap} | ${usd(r.final)} | ${usd(r.maxDd)} | ${pct(r.ret)} |`);
md.push('', '## IS (seçim dönemi) vs OOS — replay $300, aynı para yönetimi', '', '| Grup | Ticker | IS n | IS kazanma | IS ort. R | IS alınan | IS nihai | IS maks. düşüş | OOS n | OOS kazanma | OOS ort. R | OOS alınan | OOS nihai | OOS maks. düşüş |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of isRows) md.push(`| ${r.group} | ${r.ticker} | ${r.isN} | ${pct(r.isWin)} | ${f2(r.isAvgR)} | ${r.isTaken} | ${usd(r.isFinal)} | ${usd(r.isMaxDd)} | ${r.oosN} | ${pct(r.oosWin)} | ${f2(r.oosAvgR)} | ${r.oosTaken} | ${usd(r.oosFinal)} | ${usd(r.oosMaxDd)} |`);
md.push('', '## Setup × ticker (OOS) ve kriter kapısı', '', '| Grup | Setup | Ticker | n | Kazanma | Ort. R | PF | GA alt | Spread×1,5 | IS n | IS ort. R | Karar |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const r of setupRows) md.push(`| ${r.group} | ${r.setup} | ${r.ticker} | ${r.n} | ${pct(r.win)} | ${f2(r.avgR)} | ${f2(r.pf)} | ${f2(r.ciLo)} | ${f2(r.spreadR)} | ${r.isN} | ${f2(r.isAvgR)} | ${r.verdict} |`);
md.push('', '## Monte Carlo (gün bloklu, OOS günleri)', '', '| Grup | Varyant | Ufuk (gün) | Medyan | %5 | %95 | P(<başlangıç) | İflas (<%10, herhangi an) | İşlem yapamaz (bitişte) | Ort. maks. düşüş | Ort. işlem | Yetersiz sermaye | En uzun kayıp |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const m of mc) md.push(`| ${m.group} | ${m.variant} | ${m.horizon} | ${usd(m.median)} | ${usd(m.p5)} | ${usd(m.p95)} | ${pct(m.probBelowStart)} | ${pct(m.ruinProb)} | ${pct(m.stuckProb)} | ${usd(m.meanMaxDd)} | ${f2(m.meanTrades)} | ${f2(m.meanNoCapital)} | ${m.longestLoss} |`);
md.push('', '## Gece taşıma kapısı (1–3 DTE, OOS işlem günleri) — yalnız bilgi amaçlı', '', 'Motor gün içi kapanış simüle eder (gece taşıma modellenmedi); bu tablo taşınabilecek gün sayısını gösterir.', '', '| Ticker | İşlem günü | Kapıdan geçen | Bilanço durumu |', '|---|---:|---:|---|');
for (const [tk, v] of Object.entries(gateRows)) md.push(`| ${tk} | ${v.days} | ${v.pass} | ${v.earn} |`);
fs.writeFileSync(path.join(outDir, 'tables.md'), md.join('\n') + '\n');
console.error(`tamam: ${outDir} (${Math.round((Date.now() - t0) / 1000)} sn)`);
