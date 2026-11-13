/*
 * Walk-forward değerlendirme (genişleyen pencere): tarihler sıralanır; ilk trainFrac eğitim, kalan k parçaya bölünür.
 * Her katmanda parametreler YALNIZCA o test parçasından önceki günlerde aranır, en iyisi sıradaki parçada test edilir.
 * Tüm test parçalarının işlemleri birleşince örneklem DIŞI (OOS) sonuç çıkar — karar yalnızca buna göre verilir.
 */
import type { Day } from './bt.mts';
import { runStrategy, xmetrics, type ETrade, type RunOpts, type XMet } from './engine.mts';
import type { CommonParams, Strategy } from '../src/lib/odte/strategies/index.ts';

export interface Fold { trainFrom: string; trainTo: string; testFrom: string; testTo: string }
export function makeFolds(dates: string[], k = 4, trainFrac = 0.4): Fold[] {
  const ds = [...dates].sort(), n0 = Math.max(1, Math.floor(ds.length * trainFrac)), rest = ds.length - n0, out: Fold[] = [];
  for (let i = 0; i < k; i++) {
    const a = n0 + Math.floor(rest * i / k), b = n0 + Math.floor(rest * (i + 1) / k) - 1; if (b < a) continue;
    out.push({ trainFrom: ds[0], trainTo: ds[a - 1], testFrom: ds[a], testTo: ds[b] });
  }
  return out;
}
/** Varsayılan + uzaydan rastgele n örnek (tekilleştirilmiş, tohumlu) */
export function sampleParams<P extends CommonParams>(s: Strategy<P>, n: number, seed = 42): P[] {
  let x = seed; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const keys = Object.keys(s.space).filter(k => (s.space as any)[k]?.length) as (keyof P)[];
  const seen = new Set<string>(), out: P[] = [];
  const add = (p: P) => { const k = JSON.stringify(p); if (!seen.has(k)) { seen.add(k); out.push(p); } };
  add(s.defaults);
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const p = { ...s.defaults };
    for (const k of keys) { const vs = (s.space as any)[k] as any[]; if (rnd() < 0.7) (p as any)[k] = vs[Math.floor(rnd() * vs.length)]; }
    if (p.startMin > p.endMin) continue;
    add(p);
  }
  return out;
}
/** Amaç: işlem başı % getirinin t-istatistiği, en az minN işlem */
export const objective = (m: XMet, minN: number) => m.n < minN ? -99 + m.n / 1e3 : m.tstat;
export interface WfResult<P> { folds: (Fold & { best: P; train: XMet; test: XMet; evaluated: number })[]; oos: ETrade[]; oosMet: XMet }
export function walkForward<P extends CommonParams>(days: Day[], s: Strategy<P>, o: RunOpts & { k?: number; trainFrac?: number; n?: number; minN?: number; seed?: number } = {}): WfResult<P> {
  const dates = [...new Set(days.map(d => d.D))].sort(), folds = makeFolds(dates, o.k ?? 4, o.trainFrac ?? 0.4);
  const cands = sampleParams(s, o.n ?? 60, o.seed), res: WfResult<P>['folds'] = [], oos: ETrade[] = [];
  for (const f of folds) {
    const tr = days.filter(d => d.D <= f.trainTo), te = days.filter(d => d.D >= f.testFrom && d.D <= f.testTo);
    const trDays = new Set(tr.map(d => d.D)).size, minN = o.minN ?? Math.max(15, Math.round(trDays * 0.25));
    let best = cands[0], bestM = xmetrics(runStrategy(tr, s, best, o), 0), bestO = objective(bestM, minN);
    for (const p of cands.slice(1)) { const m = xmetrics(runStrategy(tr, s, p, o), 0); const ob = objective(m, minN); if (ob > bestO) { best = p; bestM = m; bestO = ob; } }
    const tt = runStrategy(te, s, best, o); oos.push(...tt);
    res.push({ ...f, best, train: bestM, test: xmetrics(tt), evaluated: cands.length });
  }
  return { folds: res, oos, oosMet: xmetrics(oos) };
}
