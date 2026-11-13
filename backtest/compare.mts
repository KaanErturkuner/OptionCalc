/*
 * Strateji karşılaştırma: aynı gün verisinde tüm (ya da seçili) stratejiler → varsayılan parametre sonucu, walk-forward OOS,
 * maliyet duyarlılığı, kırılımlar. Çıktı: <out>/<zaman>/report.json + report.md (+ latest/ kopyası).
 *
 *   node backtest/compare.mts [--s all|id1,id2] [--t SPY,QQQ,IWM] [--source modeled|recorded|hybrid]
 *                             [--folds 4] [--n 60] [--minN 0] [--out /workspace/backtest/reports] [--quick]
 * --t verilmezse her strateji kendi evreninde (universe), evren yoksa tüm sembollerde çalışır.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDays, precompute, type Day } from './bt.mts';
import { TICKERS } from './common.mts';
import { breakdown, runStrategy, xmetrics, type ETrade, type XMet } from './engine.mts';
import { walkForward } from './wf.mts';
import { makeSource, defaultCosts } from './sources.mts';
import { verdict, CRITERIA } from './criteria.mts';
import { STRATEGIES, type Strategy } from '../src/lib/odte/strategies/index.ts';
import { loadPeers } from './peers.mts';

const A = process.argv.slice(2), arg = (k: string, d?: string) => { const i = A.indexOf('--' + k); return i >= 0 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const quick = A.includes('--quick');
const sel = arg('s', 'all')!, srcKind = arg('source', process.env.BT_SOURCE || 'modeled')!;
const folds = +arg('folds', '4')!, nS = +arg('n', quick ? '12' : '60')!, minN = +arg('minN', '0')!;
const outRoot = arg('out', '/workspace/backtest/reports')!;
const tOverride = arg('t')?.split(',');
const strats: Strategy<any>[] = sel === 'all' ? STRATEGIES : sel.split(',').map(id => { const s = STRATEGIES.find(x => x.id === id); if (!s) throw new Error('bilinmeyen strateji: ' + id + ' (mevcut: ' + STRATEGIES.map(x => x.id).join(', ') + ')'); return s; });
const need = new Set<string>(); for (const s of strats) for (const t of tOverride ?? s.universe ?? TICKERS) need.add(t);
const t0 = Date.now();
const daysDir = arg('days', process.env.BT_DAYS || '/workspace/backtest/days')!;
const all = loadDays([...need], daysDir); for (const d of all) precompute(d);
const peerSyms = [...new Set(strats.flatMap(s => s.peers ?? []))];
const peers = peerSyms.length ? await loadPeers(peerSyms, all.reduce((a, d) => d.D < a ? d.D : a, '9999'), all.reduce((a, d) => d.D > a ? d.D : a, '0000')) : null;
if (peers) console.error('yardımcı semboller (gün sayısı):', JSON.stringify(peers.cover));
if (!all.length) { console.error('gün verisi yok: önce fetch.mts + prep.mts (bkz. backtest/README.md)'); process.exit(1); }
const dates = [...new Set(all.map(d => d.D))].sort();
console.error(`yüklendi ${all.length} hisse-gün, ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} gün), ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
const costs = defaultCosts(), src = makeSource(srcKind, costs), peerFn = peers?.get;
const r4 = (x: number) => isFinite(x) ? +x.toFixed(4) : null;
const slim = (m: XMet) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.isArray(v) ? v.map(r4) : r4(v as number)]));
const rows: any[] = [];
for (const s of strats) {
  const t1 = Date.now(), uni = tOverride ?? s.universe ?? TICKERS, days: Day[] = all.filter(d => uni.includes(d.ticker));
  const def = runStrategy(days, s, s.defaults, { source: src, costs, peers: peerFn });
  const sens = Object.fromEntries([0, 1, 1.5].map(k => {
    const c = { ...costs, spreadMult: k, slip: k ? costs.slip : 0, fee: k ? costs.fee : 0 };
    return [`x${k}`, slim(xmetrics(runStrategy(days, s, s.defaults, { source: makeSource(srcKind, c), costs: c, peers: peerFn }), 0))];
  }));
  const hasSpace = Object.values(s.space).some(v => (v as any[] | undefined)?.length);
  const wf = hasSpace ? walkForward(days, s, { source: src, costs, peers: peerFn, k: folds, n: nS, minN: minN || undefined }) : null;
  const oos: ETrade[] = wf ? wf.oos : def.filter(t => t.D >= (dates[Math.floor(dates.length * 0.4)] ?? ''));
  const oosM = wf ? wf.oosMet : xmetrics(oos);
  rows.push({ id: s.id, name: s.name, description: s.description, universe: uni, defaults: s.defaults,
    def: slim(xmetrics(def)), sens, oos: slim(oosM), verdict: verdict(oosM),
    folds: wf?.folds.map(f => ({ ...f, train: slim(f.train), test: slim(f.test) })) ?? null,
    brOos: breakdown(oos), brDef: breakdown(def), trades: { def, oos },
    secs: Math.round((Date.now() - t1) / 1000) });
  console.error(`${s.id}: varsayılan n=${def.length} beklenti ${(xmetrics(def).expPct * 100).toFixed(1)}% | OOS n=${oosM.n} ${(oosM.expPct * 100).toFixed(1)}% PF ${oosM.pf.toFixed(2)} → ${verdict(oosM)} (${Math.round((Date.now() - t1) / 1000)} sn)`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), dir = path.join(outRoot, stamp);
fs.mkdirSync(dir, { recursive: true });
const meta = { generated: new Date().toISOString(), source: src.id, daysDir, peers: peers?.cover ?? null, costs, folds, samples: nS, dates: { first: dates[0], last: dates[dates.length - 1], n: dates.length }, criteria: CRITERIA };
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ meta, strategies: rows }));
const pct = (x: any) => x == null ? '—' : (x * 100).toFixed(1) + '%', f2 = (x: any) => x == null ? '—' : (+x).toFixed(2);
const md: string[] = [];
md.push(`# Strateji karşılaştırma — ${meta.generated.slice(0, 16)} UTC`, '',
  `Veri: ${meta.dates.first} → ${meta.dates.last} (${meta.dates.n} işlem günü) · fiyat kaynağı **${src.id}** · maliyet: komisyon $${costs.fee}/kontrat/yön, kayma $${costs.slip}, spread ×${costs.spreadMult}`,
  `Walk-forward: ${folds} katman, genişleyen eğitim penceresi (ilk %40), katman başına ${nS} parametre seti.`,
  src.id === 'modeled' ? '\n> ⚠️ Opsiyon fiyatları MODELLENDİ (önceki gün EOD IV + sabit spread). Gerçek gün içi kotlarla (record.mts → --source hybrid) doğrulanmadan karar verilmez.\n' : '', '',
  '## Sıralama (walk-forward örneklem dışı)', '',
  '| Strateji | Evren | OOS n | Kazanma | Beklenti/işlem | %95 GA | PF | Maks. DD $ | Varsayılan n / beklenti | Spread×0 / ×1,5 | Karar |',
  '|---|---|---:|---:|---:|---|---:|---:|---|---|---|');
for (const r of [...rows].sort((a, b) => (b.oos.expPct ?? -9) - (a.oos.expPct ?? -9)))
  md.push(`| ${r.id} | ${r.universe.length > 4 ? r.universe.length + ' sembol' : r.universe.join(',')} | ${r.oos.n} | ${pct(r.oos.win)} | ${pct(r.oos.expPct)} | ${pct(r.oos.ci95[0])} … ${pct(r.oos.ci95[1])} | ${f2(r.oos.pf)} | ${f2(r.oos.mdd)} | ${r.def.n} / ${pct(r.def.expPct)} | ${pct(r.sens.x0.expPct)} / ${pct(r.sens['x1.5'].expPct)} | **${r.verdict}** |`);
md.push('', `Karar eşikleri (ADAY): OOS n ≥ ${CRITERIA.candidate.minN}, beklenti ≥ ${pct(CRITERIA.candidate.minExpPct)}, PF ≥ ${CRITERIA.candidate.minPF}, %95 GA alt sınırı ≥ ${pct(CRITERIA.candidate.minCiLo)}.`, '');
for (const r of rows) {
  md.push(`## ${r.name} (\`${r.id}\`)`, '', r.description, '');
  if (r.folds) {
    md.push('| Katman | Eğitim | Test | Eğitim n / beklenti | Test n / beklenti | Seçilen parametreler (varsayılandan farklı) |', '|---|---|---|---|---|---|');
    for (const f of r.folds) {
      const diff = Object.fromEntries(Object.entries(f.best).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((r.defaults as any)[k])));
      md.push(`| ${r.folds.indexOf(f) + 1} | ${f.trainFrom}…${f.trainTo} | ${f.testFrom}…${f.testTo} | ${f.train.n} / ${pct(f.train.expPct)} | ${f.test.n} / ${pct(f.test.expPct)} | \`${JSON.stringify(diff)}\` |`);
    }
    md.push('');
  }
  const tbl = (title: string, xs: any[]) => { if (!xs.length) return; md.push(`**${title}:** ` + xs.map(x => `${x.k} ${x.n}× ${pct(x.expPct)}`).join(' · ')); };
  tbl('OOS saat (ET)', r.brOos.tod); tbl('OOS sembol', r.brOos.ticker); tbl('OOS yön', r.brOos.dir); tbl('OOS çıkış', r.brOos.why); md.push('');
}
fs.writeFileSync(path.join(dir, 'report.md'), md.join('\n'));
const latest = path.join(outRoot, 'latest'); fs.rmSync(latest, { recursive: true, force: true }); fs.mkdirSync(latest, { recursive: true });
for (const f of ['report.json', 'report.md']) fs.copyFileSync(path.join(dir, f), path.join(latest, f));
console.error('rapor:', path.join(dir, 'report.md'), `(${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
