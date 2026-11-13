/* 2. Olağan dışı kontrat: hacim/OI ≥ 3 ve hacim ≥ max(500, ort. kontrat hacmi × 5). Call → bull, put → bear.
 *    Agresif alım (last ≥ mid) +0,15; vade ≤ 14 gün ve OTM +0,15. */
import { mid } from '../../market/types.ts';
import type { Baseline, Signal, Snapshot } from '../types.ts';
import { clamp, confidence, guard, optKey, r2, sig } from './util.ts';

export function unusual(s: Snapshot, b: Baseline): Signal[] {
  if (!guard(b, 5)) return [];
  const floor = Math.max(500, (b.avgContractVol20 ?? 0) * 5);
  const out: Signal[] = [];
  for (const o of [...s.chain.calls, ...s.chain.puts]) {
    if (o.volume < floor || o.volume / Math.max(o.oi, 1) < 3) continue;
    const m = mid(o), agresif = m > 0 && o.last >= m;
    const otm = o.type === 'call' ? o.strike > s.spot : o.strike < s.spot;
    const near = s.dte <= 14;
    const c = confidence(b, clamp(0.5 + (agresif ? 0.15 : 0) + (near && otm ? 0.15 : 0), 0, 0.95));
    out.push(sig(s, 'unusual', o.type === 'call' ? 'bull' : 'bear', c.sev, {
      kontrat: optKey(o.type, o.strike), vade: s.expiry, dte: s.dte, hacim: Math.round(o.volume), oi: Math.round(o.oi),
      hacimOi: r2(o.volume / Math.max(o.oi, 1)), agresif: agresif ? 'evet' : 'hayır', otm: otm ? 'evet' : 'hayır', guven: c.guven,
      _vol: o.volume,
    }));
  }
  return out.sort((a, b2) => (b2.facts._vol as number) - (a.facts._vol as number)).slice(0, 3)
    .map(x => { delete x.facts._vol; return x; });
}
