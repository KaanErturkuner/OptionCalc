/*
 * Qullamaggie (Q1, Q1S, Q2, Q3) backtest — Qullamaggie uyarlaması — Kaan onayı yok. firsat.mts'nin yapısını izler.
 * Walk-forward (5 kat, ilk %40 seçim; IS ve OOS ayrı), OOS işlemlerin $300 kâğıt replay'i (Kaan D12 kuralları), setup × ticker
 * kriter kapısı (backtestVerdict + FIRSAT_CRITERIA), gün bloklu Monte Carlo (birincil + hedef varyantları, "işlem yapamaz" sütunu),
 * kesirli kontrat bilgi varyantı.
 * YALNIZCA çevrimdışı veri: BT_OFFLINE=1; MARKETDATA_TOKEN ortamda olmamalı. Günlük barlar önbellekteki MarketData D mumlarından
 * (2025-11-03 →), her zaman yalnız D < gün kullanılır.
 *
 *   unset MARKETDATA_TOKEN; BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/qull.mts [--out DIR] [--n 60] [--folds 5] [--paths 10000]
 * Çıktı: <out>/report.json, <out>/tables.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDays, precompute, type Day } from './bt.mts';
import { runStrategy, type ETrade } from './engine.mts';
import { walkForward } from './wf.mts';
import { defaultCosts, makeSource } from './sources.mts';
import { START, END } from './common.mts';
import { qullStrategies, qdOf } from '../src/lib/odte/strategies/qull.ts';
import { openRange } from '../src/lib/odte/strategies/util.ts';
import { breakIndex, breakVolRatio } from '../src/lib/signals/setups/q-common.ts';
import { failedVwapReclaim } from '../src/lib/signals/setups/q3-parabolik.ts';
import { replayTrades, runPathMc, rSummary, bootstrapMeanCiLo, rUnder, type PathTrade } from '../src/lib/paper/path.ts';
import { backtestVerdict } from '../src/lib/signals/criteria.ts';
import { etDate } from '../src/lib/usmarket.ts';
import { toPath, pct, f2, usd } from './tables-common.mts';
import type { DailyBar } from '../src/lib/signals/qull/daily.ts';

const A = process.argv.slice(2), arg = (k: string, d?: string) => { const i = A.indexOf('--' + k); return i >= 0 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
if (!process.env.BT_OFFLINE) { console.error('BT_OFFLINE=1 gerekli (bu koşu yalnız önbellek ve yerel gün dosyalarıyla çalışır).'); process.exit(1); }
if (process.env.MARKETDATA_TOKEN) { console.error('MARKETDATA_TOKEN ortamda olmamalı (çevrimdışı koşu). `unset MARKETDATA_TOKEN` çalıştırın.'); process.exit(1); }
const outDir = arg('out', '/workspace/backtest/reports/qullamaggie')!;
const nS = +arg('n', '60')!, folds = +arg('folds', '5')!, paths = +arg('paths', '10000')!;
const TICK = ['QQQ', 'GLD', 'SLV', 'NVDA', 'MU', 'INTC'];
const GROUPS = [
  { id: '0DTE', dir: arg('days0', '/workspace/backtest/days')! },
  { id: '1–3 DTE', dir: arg('days13', '/workspace/backtest/days-dte13')! },
];
const SETUP_IDS = ['Q1', 'Q1S', 'Q2', 'Q3'] as const;
const CACHE = process.env.BT_CACHE || '/workspace/backtest/cache';
const KAAN = { targetN: 5 };
const START_CAP = 300;
const t0 = Date.now();

/** Önbellekteki günlük D mumları: ticker başına en eski `from` olan tam yanıt. Her dosyanın yalnız ilk 512 baytı okunur (ön süzgeç). */
function loadDailyCache(syms: string[]): Map<string, DailyBar[]> {
  const want = new Set(syms), best = new Map<string, { from: string; json: any }>();
  const head = Buffer.alloc(512);
  for (const f of fs.readdirSync(CACHE)) {
    const fp = path.join(CACHE, f), fd = fs.openSync(fp, 'r');
    const n = fs.readSync(fd, head, 0, 512, 0); fs.closeSync(fd);
    if (!head.toString('utf8', 0, n).includes('"p":"/stocks/candles/D/')) continue;
    let j: any; try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    const m = /^\/stocks\/candles\/D\/([^/]+)\/\?from=([0-9-]+)/.exec(String(j.p ?? ''));
    if (!m || !want.has(m[1]) || j.json?.s !== 'ok' || !Array.isArray(j.json.t)) continue;
    const cur = best.get(m[1]);
    if (!cur || m[2] < cur.from) best.set(m[1], { from: m[2], json: j.json });
  }
  const out = new Map<string, DailyBar[]>();
  for (const [tk, { json: b }] of best) {
    const bars: DailyBar[] = b.t.map((t: number, i: number) => ({ D: etDate(t * 1000), o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i] }));
    out.set(tk, bars.sort((x, y) => x.D.localeCompare(y.D)));
  }
  return out;
}

const dailyMap = loadDailyCache([...TICK, 'SPY']);
for (const tk of [...TICK, 'SPY']) {
  const bs = dailyMap.get(tk) ?? [];
  console.error(`günlük ${tk}: ${bs.length} bar${bs.length ? `, ${bs[0].D} → ${bs[bs.length - 1].D}` : ' (YOK)'}`);
}
// RS63 için en az 64 önceki gün gerekir: ilk hazır gün (SPY serisinden)
const spyBars = dailyMap.get('SPY') ?? [];
const rsReadyDay = spyBars.length > 63 ? spyBars[63].D : null;

const costs = defaultCosts(), c15 = { ...costs, spreadMult: 1.5 };
const src = makeSource('modeled', costs), src15 = makeSource('modeled', c15);

const groups = GROUPS.map(g => {
  const days: Day[] = loadDays(TICK, g.dir);
  for (const d of days) { precompute(d); d.qDaily = dailyMap.get(d.ticker); d.qSpy = dailyMap.get('SPY'); }
  return { ...g, days, dates: [...new Set(days.map(d => d.D))].sort() };
});
for (const g of groups) console.error(`${g.id}: ${g.days.length} hisse-gün, ${g.dates[0]} → ${g.dates[g.dates.length - 1]}`);

/* ——— 1) walk-forward + IS + spread×1,5 ——— */
interface Run { group: string; id: string; name: string; folds: any[]; is: ETrade[]; oos: ETrade[]; oos15: ETrade[]; foldTest: [string, string][] }
const runs: Run[] = [];
for (const g of groups) {
  for (const s of qullStrategies) {
    const ts = Date.now();
    const wf = walkForward(g.days, s, { source: src, costs, kaan: KAAN, k: folds, n: nS, trainFrac: 0.4 });
    const isEnd = g.dates[Math.floor(g.dates.length * 0.4) - 1];
    const is = runStrategy(g.days.filter(d => d.D <= isEnd), s, s.defaults, { source: src, costs, kaan: KAAN });
    const oos15 = wf.folds.flatMap(f => runStrategy(g.days.filter(d => d.D >= f.testFrom && d.D <= f.testTo), s, f.best, { source: src15, costs: c15, kaan: KAAN }));
    runs.push({ group: g.id, id: s.id, name: s.name, is, oos: wf.oos, oos15, foldTest: wf.folds.map(f => [f.testFrom, f.testTo] as [string, string]),
      folds: wf.folds.map(f => ({ trainFrom: f.trainFrom, trainTo: f.trainTo, testFrom: f.testFrom, testTo: f.testTo, best: f.best, trainN: f.train.n, testN: f.test.n, evaluated: f.evaluated })) });
    console.error(`${g.id} ${s.id}: IS n=${is.length} · OOS n=${wf.oos.length} · ${Math.round((Date.now() - ts) / 1000)} sn`);
  }
}

/* ——— 2a) huni: koşul koşul kaç hisse-günü kalıyor (tüm günler; ızgara 5 dk; pencere 09:35–13:00) ——— */
interface FunnelRow { group: string; setup: string; days: number; daily: number; intraday: number; volume: number; withSignal: number }
const funnelRows: FunnelRow[] = [];
for (const g of groups) {
  const acc: Record<string, { daily: number; intraday: number; volume: number }> = {};
  for (const s of ['Q1', 'Q1S', 'Q2', 'Q3']) acc[s] = { daily: 0, intraday: 0, volume: 0 };
  for (const d of g.days) {
    const qd = qdOf({ ticker: d.ticker, date: d.D, dte: d.dte, daily: d.qDaily, spyDaily: d.qSpy } as any);
    if (!qd) continue;
    const spyOk = (up: boolean) => !qd.spy || (qd.rs63 != null && (up ? qd.rs63 > 0 : qd.rs63 < 0));
    const gateDay: Record<string, boolean> = {
      Q1: qd.trendUp && spyOk(true) && qd.consol.rangeContraction <= 0.8 && qd.consol.nearHigh,
      Q1S: qd.trendDown && spyOk(false) && qd.consol.rangeContraction <= 0.8 && qd.consol.nearLow,
      Q2: Math.abs((d.bars[0]?.o ?? NaN) / qd.lastClose - 1) >= Math.max(0.03, 1.5 * qd.atrPct),
      Q3: qd.ext >= 3 && qd.upDays >= 3,
    };
    const brkDir: Record<string, 'bull' | 'bear'> = { Q1: 'bull', Q1S: 'bear', Q3: 'bear' };
    for (const sid of Object.keys(acc)) if (gateDay[sid]) acc[sid].daily++;
    const hitIntra: Record<string, boolean> = {}, hitVol: Record<string, boolean> = {};
    for (let m = 5; m <= Math.min(210, d.bars.length); m += 5) {
      const bars = d.bars.slice(0, m), or5 = openRange(bars, 5);
      if (!or5) continue;
      for (const sid of ['Q1', 'Q1S', 'Q3']) {
        if (sid === 'Q3') {   // Q3: hacim koşulu yok; ORL kırılımı ya da ilk 30 dk VWAP geri alınamaması
          if (breakIndex(bars, or5, 'bear') != null || (m <= 30 && failedVwapReclaim(bars))) { hitIntra.Q3 = true; hitVol.Q3 = true; }
          continue;
        }
        const f = breakIndex(bars, or5, brkDir[sid]);
        if (f == null) continue;
        hitIntra[sid] = true;
        if (breakVolRatio(bars, f) >= 1.5) hitVol[sid] = true;
      }
      // Q2: gap yönünde kırılım + ilk 15 dk hacmi (m ≥ 15)
      if (m >= 15 && gateDay.Q2) {
        const dir: 'bull' | 'bear' = d.bars[0].o > qd.lastClose ? 'bull' : 'bear';
        const f = breakIndex(bars, or5, dir);
        const vol15 = bars.slice(0, 15).reduce((x, b) => x + b.v, 0), normal15 = qd.avgVol20 / 26;
        if (f != null) { hitIntra.Q2 = true; if (breakVolRatio(bars, f) >= 1.5 && vol15 >= 3 * normal15) hitVol.Q2 = true; }
      }
    }
    for (const sid of Object.keys(acc)) {
      if (hitIntra[sid]) acc[sid].intraday++;
      if (hitVol[sid] && gateDay[sid]) acc[sid].volume++;
    }
  }
  for (const sid of Object.keys(acc)) {
    const withSignal = runs.filter(r => r.group === g.id && r.id === `qull-${sid.toLowerCase()}`).reduce((x, r) => x + r.is.length + r.oos.length, 0);
    funnelRows.push({ group: g.id, setup: sid, days: g.days.length, daily: acc[sid].daily, intraday: acc[sid].intraday, volume: acc[sid].volume, withSignal });
  }
}

/* ——— 2) setup × ticker (OOS) ve kriter kapısı ——— */
interface SetupRow { group: string; setup: string; ticker: string; n: number; win: number; avgR: number; pf: number; ciLo: number; spreadR: number; verdict: string; failed: string[]; isN: number; isAvgR: number }
const setupRows: SetupRow[] = [];
for (const r of runs) for (const tk of TICK) {
  const tr = r.oos.filter(t => t.ticker === tk), tr15 = r.oos15.filter(t => t.ticker === tk);
  const R5 = tr.map(t => rUnder(toPath(t), 5)), sm = rSummary(R5), sm15 = rSummary(tr15.map(t => rUnder(toPath(t), 5)));
  const ci = bootstrapMeanCiLo(R5);
  const v = backtestVerdict({ n: sm.n, expR: sm.avg, pf: sm.pf, ciLo: ci, expRSpread15: sm15.avg });
  const isTr = r.is.filter(t => t.ticker === tk);
  setupRows.push({ group: r.group, setup: r.id.replace('qull-', '').toUpperCase(), ticker: tk, n: sm.n, win: sm.win, avgR: sm.avg, pf: sm.pf, ciLo: ci,
    spreadR: sm15.avg, verdict: v.verdict, failed: v.failed, isN: isTr.length, isAvgR: rSummary(isTr.map(t => rUnder(toPath(t), 5))).avg });
}

/* ——— 3) replay $300: setup, ticker ve grup toplamı; IS vs OOS ——— */
const replayRow = (label: string, group: string, trades: ETrade[]) => {
  const pathsOf = trades.map(toPath), R5 = pathsOf.map(p => rUnder(p, 5)), sm = rSummary(R5);
  const rp = replayTrades(pathsOf, { startCapital: START_CAP });
  return { group, label, n: trades.length, win: sm.win, avgR: sm.avg, pf: sm.pf, taken: rp.taken, busy: rp.busy, durdu: rp.durdu, noCap: rp.noCapital, final: rp.final, maxDd: rp.maxDd };
};
const isReplayRow = (label: string, group: string, trades: ETrade[]) => {
  const pathsOf = trades.map(toPath), sm = rSummary(pathsOf.map(p => rUnder(p, 5))), rp = replayTrades(pathsOf, { startCapital: START_CAP });
  return { group, label, n: trades.length, win: sm.win, avgR: sm.avg, taken: rp.taken, final: rp.final, maxDd: rp.maxDd };
};
const setupReplay: any[] = [], tickerReplay: any[] = [], isOosRows: any[] = [];
const medFill: Record<string, number> = {};
for (const g of groups) {
  const gr = runs.filter(r => r.group === g.id);
  const oosAll = gr.flatMap(r => r.oos), isAll = gr.flatMap(r => r.is);
  for (const r of gr) {
    const setup = r.id.replace('qull-', '').toUpperCase();
    setupReplay.push({ ...replayRow(setup, g.id, r.oos), tickers: 'tümü' });
    const isR = isReplayRow(setup, g.id, r.is), oosR = replayRow(setup, g.id, r.oos);
    isOosRows.push({ group: g.id, setup, isN: isR.n, isWin: isR.win, isAvgR: isR.avgR, isTaken: isR.taken, isFinal: isR.final, isMaxDd: isR.maxDd,
      oosN: oosR.n, oosWin: oosR.win, oosAvgR: oosR.avgR, oosTaken: oosR.taken, oosFinal: oosR.final, oosMaxDd: oosR.maxDd });
  }
  // Tüm Q setupları birlikte (tek hesap)
  const allRep = replayRow('Tümü (Q1+Q1S+Q2+Q3)', g.id, oosAll), allIs = isReplayRow('Tümü', g.id, isAll);
  setupReplay.push({ ...allRep, tickers: 'tümü' });
  isOosRows.push({ group: g.id, setup: 'Tümü', isN: allIs.n, isWin: allIs.win, isAvgR: allIs.avgR, isTaken: allIs.taken, isFinal: allIs.final, isMaxDd: allIs.maxDd,
    oosN: allRep.n, oosWin: allRep.win, oosAvgR: allRep.avgR, oosTaken: allRep.taken, oosFinal: allRep.final, oosMaxDd: allRep.maxDd });
  for (const tk of TICK) {
    const sel = oosAll.filter(t => t.ticker === tk);
    tickerReplay.push(replayRow(tk, g.id, sel));
  }
  const fs_ = oosAll.map(t => toPath(t).fill).sort((a, b) => a - b);
  medFill[g.id] = fs_.length ? fs_[Math.floor(fs_.length / 2)] : NaN;
}

/* ——— 4) Monte Carlo (gün bloklu, OOS günleri; işlem günleri + işlemsiz günler) ——— */
const variants = [
  { id: 'birincil', label: 'Birincil: 1:5 (AGRESIF) / 1:2 (güvenli), DURDU açık, tam kontrat', policy: { agresif: 5, safe: 2 }, settings: {} },
  { id: 'hedef12', label: '[grok] Hedef 1:2 sabit (tüm modlar)', policy: { agresif: 2, safe: 2 }, settings: {} },
  { id: 'hedef115', label: '[grok] Hedef 1:1,5 sabit (tüm modlar)', policy: { agresif: 1.5, safe: 1.5 }, settings: {} },
  { id: 'durdu-kapali', label: 'Karşılaştırma: DURDU kapalı', policy: { agresif: 5, safe: 2 }, settings: { durduEnabled: false } },
  { id: 'kesirli', label: 'Bilgi amaçlı: kesirli kontrat (Kaan kuralı DEĞİL)', policy: { agresif: 5, safe: 2 }, settings: { fractional: true } },
];
const mc: any[] = [];
for (const g of groups) {
  const gr = runs.filter(r => r.group === g.id);
  const pool = gr.flatMap(r => r.oos).map(toPath);
  const testDates = g.dates.filter(D => gr[0].foldTest.some(([a, b]) => D >= a && D <= b));
  const byDay = new Map<string, PathTrade[]>();
  for (const D of testDates) byDay.set(D, []);
  for (const p of pool) byDay.get(p.D)?.push(p);
  const mcSet = [...byDay.values()];
  for (const v of variants) {
    const st = runPathMc(mcSet, { startCapital: START_CAP, horizons: [20, 60], paths, seed: 20261113, policy: v.policy, settings: v.settings,
      stuckBelow: (medFill[g.id] * 100 + 1.5) / 0.5 });   // %50 kademeyle medyan OOS dolumunda 1 kontrat alınamıyor
    for (const s of st) mc.push({ group: g.id, variant: v.id, label: v.label, ...s });
  }
}

/* ——— 5) çıktılar ——— */
const report = { generated: new Date().toISOString(), window: { start: START, end: END }, costs, c15, folds, samples: nS, paths, startCapital: START_CAP,
  tickers: TICK, rsReadyDay, funnelRows, setupRows, setupReplay, tickerReplay, isOosRows, medFill, mc, days: Object.fromEntries(groups.map(g => [g.id, g.days.length])),
  runs: runs.map(r => ({ group: r.group, id: r.id, folds: r.folds, is: r.is.length, oos: r.oos.length, oos15: r.oos15.length })) };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
// İşlem dökümü (tekrarlanabilirlik ve denetim): IS ve OOS, her işlem ayrı satır
const dump = (set: 'is' | 'oos') => runs.flatMap(r => r[set].map(t => { const p = toPath(t); return { group: r.group, setup: r.id.replace('qull-', '').toUpperCase(), set,
  ticker: t.ticker, D: t.D, m: t.m, dir: t.dir, fill: +p.fill.toFixed(4), R: +t.R.toFixed(4), hit1_5: !!t.hit[1.5], hit2: !!t.hit[2], hit5: !!t.hit[5], stopped: t.stopped, why: t.why, note: (t as any).note }; }));
fs.writeFileSync(path.join(outDir, 'trades.json'), JSON.stringify([...dump('is'), ...dump('oos')], null, 1));

const md: string[] = [];
md.push('# Qullamaggie tabloları (otomatik)', '', `Pencere: ${START} → ${END} · maliyet: $${costs.fee}/kontrat/yön, kayma $${costs.slip}, spread ×${costs.spreadMult} · walk-forward ${folds} kat, ${nS} parametre seti, ilk %40 seçim · MC ${paths} yol · RS63 ilk hazır gün (SPY): ${rsReadyDay ?? '—'}`, '');
md.push('## Huni (koşul koşul hisse-gün sayısı; tüm günler, ızgara 5 dk, pencere 09:35–13:00)', '', 'Günlük koşul: yapısal (trend/RS/daralma/yakınlık; Q2 için gap eşiği; Q3 için uzama). Gün içi kırılım: taze ilk kırılım (son 5 dk). Hacim: kırılım barında ≥ 1,5× (Q2 ayrıca ilk 15 dk ≥ 3×; Q3 için hacim koşulu yok, ORL ya da VWAP geri alınamaması; yalnız günlük koşulu sağlayan günler). Sinyal: walk-forward IS+OOS n (strateji sayısı).', '', '| Grup | Setup | Toplam gün | Günlük koşul | + gün içi kırılım | + hacim (aday gün üst sınırı) | Sinyal (IS+OOS n) |', '|---|---|---:|---:|---:|---:|---:|');
for (const r of funnelRows) md.push(`| ${r.group} | ${r.setup} | ${r.days} | ${r.daily} | ${r.intraday} | ${r.volume} | ${r.withSignal} |`);
md.push('', '## Setup × ticker (OOS) ve kriter kapısı', '', '| Grup | Setup | Ticker | n | Kazanma | Ort. R | PF | GA alt | Spread×1,5 | IS n | IS ort. R | Karar |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const r of setupRows) md.push(`| ${r.group} | ${r.setup} | ${r.ticker} | ${r.n} | ${pct(r.win)} | ${f2(r.avgR)} | ${f2(r.pf)} | ${f2(r.ciLo)} | ${f2(r.spreadR)} | ${r.isN} | ${f2(r.isAvgR)} | ${r.verdict}${r.failed.length ? ' (' + r.failed.join('; ') + ')' : ''} |`);
md.push('', '## IS (seçim dönemi) vs OOS — replay $300, aynı para yönetimi', '', '| Grup | Setup | IS n | IS kazanma | IS ort. R | IS alınan | IS nihai | IS maks. düşüş | OOS n | OOS kazanma | OOS ort. R | OOS alınan | OOS nihai | OOS maks. düşüş |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of isOosRows) md.push(`| ${r.group} | ${r.setup} | ${r.isN} | ${pct(r.isWin)} | ${f2(r.isAvgR)} | ${r.isTaken} | ${usd(r.isFinal)} | ${usd(r.isMaxDd)} | ${r.oosN} | ${pct(r.oosWin)} | ${f2(r.oosAvgR)} | ${r.oosTaken} | ${usd(r.oosFinal)} | ${usd(r.oosMaxDd)} |`);
md.push('', '## Setup replay (OOS, $300; Tümü = tüm Q setupları tek hesapta)', '', '| Grup | Setup | Sinyal n | Kazanma | Ort. R | PF | Alınan | Meşgul | DURDU | Yetersiz sermaye | Nihai | Maks. düşüş |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of setupReplay) md.push(`| ${r.group} | ${r.label} | ${r.n} | ${pct(r.win)} | ${f2(r.avgR)} | ${f2(r.pf)} | ${r.taken} | ${r.busy} | ${r.durdu} | ${r.noCap} | ${usd(r.final)} | ${usd(r.maxDd)} |`);
md.push('', '## Ticker replay (OOS, $300; tüm Q setupları birlikte her ticker kendi hesabında)', '', '| Grup | Ticker | Sinyal n | Kazanma | Ort. R | PF | Alınan | Yetersiz sermaye | Nihai | Maks. düşüş |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of tickerReplay) md.push(`| ${r.group} | ${r.label} | ${r.n} | ${pct(r.win)} | ${f2(r.avgR)} | ${f2(r.pf)} | ${r.taken} | ${r.noCap} | ${usd(r.final)} | ${usd(r.maxDd)} |`);
md.push('', '## Monte Carlo (gün bloklu, OOS günleri)', '', '| Grup | Varyant | Ufuk (gün) | Medyan | %5 | %95 | P(<başlangıç) | İflas (<%10, herhangi an) | İşlem yapamaz (bitişte) | Ort. maks. düşüş | Ort. işlem | Yetersiz sermaye | En uzun kayıp |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const m of mc) md.push(`| ${m.group} | ${m.variant} | ${m.horizon} | ${usd(m.median)} | ${usd(m.p5)} | ${usd(m.p95)} | ${pct(m.probBelowStart)} | ${pct(m.ruinProb)} | ${pct(m.stuckProb)} | ${usd(m.meanMaxDd)} | ${f2(m.meanTrades)} | ${f2(m.meanNoCapital)} | ${m.longestLoss} |`);
fs.writeFileSync(path.join(outDir, 'tables.md'), md.join('\n') + '\n');
console.error(`tamam: ${outDir} (${Math.round((Date.now() - t0) / 1000)} sn)`);
