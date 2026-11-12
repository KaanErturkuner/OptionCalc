/* Çok bacaklı strateji hesapları (web sürümündeki strategy.js'in TS portu) */
import * as BS from './bs.ts';

export type LegKind = 'call' | 'put' | 'stock';
export interface Leg {
  id?: number; kind: LegKind; side: number; strike: number; expiry: string;
  iv: number; qty: number; premium: number | null;
}
export interface Globals { S: number; r: number; q: number; today: string }
export interface Analysis {
  expiry: string; maxProfit: number; maxLoss: number; breakevens: number[]; pop: number;
  cost: number; expectedMove: number; sameExp: boolean; T: number; sig: number;
}

const DAY = 86400000;
export function parseDate(s: string) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
export function fmtDate(t: number) { return new Date(t).toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((parseDate(b) - parseDate(a)) / DAY); }
export function addDays(s: string, n: number) { return fmtDate(parseDate(s) + n * DAY); }

export const mult = (leg: Leg) => leg.kind === 'stock' ? 1 : 100;
export const optLegs = (legs: Leg[]) => legs.filter(l => l.kind !== 'stock');

export function legValue(leg: Leg, g: Globals, S: number, date: string, ivShift = 0): number {
  if (leg.kind === 'stock') return S;
  const T = Math.max(daysBetween(date, leg.expiry), 0) / 365;
  const iv = Math.max((leg.iv + (ivShift || 0)) / 100, 0.0001);
  return BS.price(leg.kind, S, leg.strike, T, g.r / 100, g.q / 100, iv);
}
export function legTheo(leg: Leg, g: Globals) { return legValue(leg, g, g.S, g.today, 0); }
export function legEntry(leg: Leg, g: Globals): number {
  if (leg.premium != null && isFinite(leg.premium)) return leg.premium;
  return leg.kind === 'stock' ? g.S : legTheo(leg, g);
}
export function cost(legs: Leg[], g: Globals) { return legs.reduce((a, l) => a + l.side * l.qty * mult(l) * legEntry(l, g), 0); }
export function value(legs: Leg[], g: Globals, S: number, date: string, ivShift = 0) {
  return legs.reduce((a, l) => a + l.side * l.qty * mult(l) * legValue(l, g, S, date, ivShift), 0);
}
export function pnl(legs: Leg[], g: Globals, S: number, date: string, ivShift = 0) { return value(legs, g, S, date, ivShift) - cost(legs, g); }
export function firstExpiry(legs: Leg[], g: Globals): string {
  const o = optLegs(legs); if (!o.length) return addDays(g.today, 30);
  return o.map(l => l.expiry).sort()[0];
}
export function lastExpiry(legs: Leg[], g: Globals): string {
  const o = optLegs(legs); if (!o.length) return addDays(g.today, 30);
  return o.map(l => l.expiry).sort().pop() as string;
}
export function legGreeks(leg: Leg, g: Globals, S: number, date: string, ivShift = 0): BS.Greeks {
  const k = leg.side * leg.qty * mult(leg);
  if (leg.kind === 'stock') return { delta: k, gamma: 0, theta: 0, vega: 0, rho: 0 };
  const T = Math.max(daysBetween(date, leg.expiry), 0) / 365;
  const gr = BS.greeks(leg.kind, S, leg.strike, T, g.r / 100, g.q / 100, Math.max((leg.iv + (ivShift || 0)) / 100, 0.0001));
  return { delta: gr.delta * k, gamma: gr.gamma * k, theta: gr.theta * k, vega: gr.vega * k, rho: gr.rho * k };
}
export function totalGreeks(legs: Leg[], g: Globals): BS.Greeks {
  const t: BS.Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  legs.forEach(l => {
    const x = legGreeks(l, g, g.S, g.today, 0);
    (Object.keys(t) as (keyof BS.Greeks)[]).forEach(k => { t[k] += x[k]; });
  });
  return t;
}
export function avgIV(legs: Leg[]) {
  const o = optLegs(legs); if (!o.length) return 30;
  const w = o.reduce((a, l) => a + l.qty, 0) || 1;
  return o.reduce((a, l) => a + l.iv * l.qty, 0) / w;
}

// Vade analizi: max kâr/zarar, başabaş noktaları, kâr olasılığı
export function analyze(legs: Leg[], g: Globals): Analysis {
  const exp = firstExpiry(legs, g);
  const strikes = optLegs(legs).map(l => l.strike);
  const top = Math.max(g.S, ...strikes, 1) * 4;
  const f = (S: number) => pnl(legs, g, S, exp, 0);
  const pts = new Set<number>([1e-6, top]); strikes.forEach(k => pts.add(k));
  for (let i = 1; i < 800; i++) pts.add(top * i / 800);
  const xs = [...pts].sort((a, b) => a - b), ys = xs.map(f);
  let maxP = Math.max(...ys), maxL = Math.min(...ys);
  const yBig = f(top * 10), yBig2 = f(top * 20), tol = 1e-6 * (1 + Math.abs(yBig));
  const unlimitedUp = yBig2 > yBig + tol && yBig2 > maxP;
  const unlimitedDown = yBig2 < yBig - tol && yBig2 < maxL;
  maxP = Math.max(maxP, yBig, yBig2); maxL = Math.min(maxL, yBig, yBig2);
  const be: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const a = ys[i - 1], b = ys[i];
    if (a === 0 && (i === 1 || ys[i - 2] !== 0)) { if (xs[i - 1] > 1e-3) be.push(xs[i - 1]); continue; }
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      let lo = xs[i - 1], hi = xs[i], flo = a;
      for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, fm = f(m); if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m; }
      be.push((lo + hi) / 2);
    }
  }
  const T = Math.max(daysBetween(g.today, exp), 0) / 365, sig = avgIV(legs) / 100;
  let pop = 0;
  if (T > 0) {
    const mu = Math.log(g.S) + (g.r / 100 - g.q / 100 - sig * sig / 2) * T, sd = sig * Math.sqrt(T);
    const cdf = (x: number) => x <= 0 ? 0 : BS.ncdf((Math.log(x) - mu) / sd);
    const cuts = [0, ...be, Infinity];
    for (let i = 0; i < cuts.length - 1; i++) {
      const lo = cuts[i], hi = cuts[i + 1];
      const mid = hi === Infinity ? Math.max(lo * 1.5, lo + 1) : (lo + hi) / 2;
      if (f(mid) > 0) pop += (hi === Infinity ? 1 : cdf(hi)) - cdf(lo);
    }
  } else pop = f(g.S) > 0 ? 1 : 0;
  const c = cost(legs, g);
  const sameExp = new Set(optLegs(legs).map(l => l.expiry)).size <= 1;
  return { expiry: exp, maxProfit: unlimitedUp ? Infinity : maxP, maxLoss: unlimitedDown ? -Infinity : maxL,
           breakevens: be, pop, cost: c, expectedMove: g.S * sig * Math.sqrt(T), sameExp, T, sig };
}

// Yüzde tabanı: debit işlemde ödenen net prim, credit işlemde risk (max zarar)
export function pctBase(an: Analysis): { base: number; label: string } {
  if (an.cost > 0) return { base: an.cost, label: 'ödenen net prime göre' };
  if (isFinite(an.maxLoss) && an.maxLoss < 0) return { base: -an.maxLoss, label: 'riske (max zarar) göre' };
  return { base: Math.abs(an.cost) || 1, label: 'alınan prime göre' };
}
