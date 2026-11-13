import type { Baseline, Direction, Signal, SignalKind, Snapshot } from '../types.ts';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const r2 = (x: number) => +x.toFixed(2);
/** Taban çizgisi yeterli mi? n < min → dedektör çalışmaz; n < 20 → düşük güven (şiddet ×0,8, facts.guven) */
export function guard(b: Baseline, min: number): boolean { return b.n >= min; }
export function confidence(b: Baseline, sev: number): { sev: number; guven: string } {
  return b.n < 20 ? { sev: sev * 0.8, guven: 'düşük' } : { sev, guven: 'normal' };
}
export function sig(s: Snapshot, kind: SignalKind, direction: Direction, severity: number, facts: Signal['facts']): Signal {
  return { id: `${s.ticker}-${kind}-${s.now}-${direction}`, ticker: s.ticker, kind, severity: clamp(severity, 0, 1), direction, facts, at: s.now };
}
export const optKey = (type: 'call' | 'put', strike: number) => (type === 'call' ? 'C' : 'P') + strike;
