/* 3. OI birikimi: bir kontratta OI ≥ %50 artış ve ≥ 2.000 kontrat (önceki gün sonu OI ile karşılaştırma). Call → bull, put → bear. */
import type { Signal, Snapshot } from '../types.ts';
import { clamp, optKey, r2, sig } from './util.ts';

export function oiBuild(s: Snapshot): Signal[] {
  if (!s.prevOi) return [];
  const out: Signal[] = [];
  for (const o of [...s.chain.calls, ...s.chain.puts]) {
    const prev = s.prevOi[optKey(o.type, o.strike)];
    if (prev == null || prev <= 0) continue;
    const add = o.oi - prev;
    if (add < 2000 || o.oi < prev * 1.5) continue;
    out.push(sig(s, 'oiBuild', o.type === 'call' ? 'bull' : 'bear', clamp(0.5 + add / 20000, 0.5, 0.85), {
      kontrat: optKey(o.type, o.strike), vade: s.expiry, oi: Math.round(o.oi), onceki: Math.round(prev), artisPct: r2((o.oi / prev - 1) * 100),
    }));
  }
  return out.sort((a, b) => (b.severity - a.severity)).slice(0, 3);
}
