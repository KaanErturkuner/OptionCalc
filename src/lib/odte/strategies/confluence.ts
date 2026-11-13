/* Mevcut uygulama motoru (signal.ts decide(), v2 varsayılanları) strateji arayüzüne sarılı — yeni fikirlerle aynı veride kıyas için taban. */
import * as SG from '../signal.ts';
import { openingRange } from '../analytics.ts';
import { COMMON_DEFAULTS, inWindow, type CommonParams, type Strategy } from './types.ts';

export interface ConfluenceParams extends CommonParams { engine: SG.EngineOpts }
export const confluence: Strategy<ConfluenceParams> = {
  id: 'confluence-v2', name: 'Uygulama motoru v2 (çoklu gösterge puanı)',
  description: 'Uygulamadaki mevcut 0DTE motoru: VWAP/ORB/momentum + GEX/duvar/max pain/PC puanı. Kıyas tabanı.',
  defaults: { ...COMMON_DEFAULTS, startMin: SG.DEFAULT_OPTS.startMin ?? 15, endMin: SG.DEFAULT_OPTS.endMin ?? 180, targetDelta: SG.DEFAULT_OPTS.targetDelta ?? 0.6,
    maxSpread: SG.DEFAULT_OPTS.maxSpread, minVol: SG.DEFAULT_OPTS.minVol, minOI: SG.DEFAULT_OPTS.minOI, engine: SG.DEFAULT_OPTS },
  space: {},
  evaluate(c, p) {
    if (!inWindow(c.m, p)) return null;
    const o = p.engine, F = o.orMinutes === c.F.orMinutes ? c.F : { ...c.F, orng: openingRange(c.bars, o.orMinutes), orMinutes: o.orMinutes };
    const r = SG.decide(c.ticker, c.S, c.chain(), { ...F, bars: c.bars }, c.t, o, { requireOpen: false });
    if (!r.signal) return null;
    return { dir: r.signal.dir, undTarget: r.signal.undTarget, undStop: r.signal.undStop, targetDelta: o.targetDelta, score: r.score, note: `puan ${r.score}` };
  },
};
/** v1 kuralları (karşılaştırma) */
export const confluenceV1: Strategy<ConfluenceParams> = { ...confluence, id: 'confluence-v1', name: 'Uygulama motoru v1',
  defaults: { ...confluence.defaults, startMin: 15, endMin: 330, targetDelta: 0.45, maxSpread: 0.12, minVol: 100, minOI: 300, engine: SG.V1_OPTS } };
