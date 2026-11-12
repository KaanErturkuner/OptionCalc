/* Çok bacaklı strateji hesapları — Amerikan tipi fiyatlama, ABD saati (16:00 ET kapanış) */
import * as A from './american.ts';
import { ncdf } from './bs.ts';
import { DAY_MS, YEAR_MS, closeMs, etDate, exDivMs } from './usmarket.ts';

export type LegKind = 'call' | 'put' | 'stock';
export interface Leg {
  id?: number; kind: LegKind; side: number; strike: number; expiry: string;
  iv: number; qty: number; premium: number | null;
}
export interface Div { date: string; amount: number }
/** S $, r ve q yüzde (4.2 = %4,2), divs nakit temettüler (ex-tarih), now = değerleme anı (ms) */
export interface Globals { S: number; r: number; q: number; divs: Div[]; now: number }
export interface Analysis {
  expiry: string; maxProfit: number; maxLoss: number; breakevens: number[]; pop: number;
  cost: number; expectedMove: number; sameExp: boolean; T: number; sig: number;
}
export type Quality = 'full' | 'fast';

export function parseDate(s: string) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
export function fmtDate(t: number) { return new Date(t).toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((parseDate(b) - parseDate(a)) / DAY_MS); }
export function addDays(s: string, n: number) { return fmtDate(parseDate(s) + n * DAY_MS); }
export const todayOf = (g: Globals) => etDate(g.now);

export const MULT = 100; // ABD standart kontrat çarpanı
export const mult = (leg: Leg) => leg.kind === 'stock' ? 1 : MULT;
export const optLegs = (legs: Leg[]) => legs.filter(l => l.kind !== 'stock');

/** Değerleme zamanı: tarih (YYYY-MM-DD) veya doğrudan an (ms) */
export type When = string | number;
/** Senaryo tarihi → değerleme anı: bugün ise şu an, ileri tarih ise o günün 16:00 ET kapanışı */
export function valTime(g: Globals, when: When): number {
  if (typeof when === 'number') return Math.max(when, g.now);
  return when <= todayOf(g) ? g.now : closeMs(when);
}
/** Vade anı (16:00 ET) — bugün vadesi dolan opsiyonda da "vadede" değerini verir */
export const atClose = (date: string) => closeMs(date);
/** Vadeye kalan süre (yıl) */
export function yearsLeft(g: Globals, date: When, expiry: string): number {
  return Math.max(closeMs(expiry) - valTime(g, date), 0) / YEAR_MS;
}
function cashDivs(g: Globals, t0: number): A.CashDiv[] {
  return g.divs.filter(d => d.amount > 0).map(d => ({ t: (exDivMs(d.date) - t0) / YEAR_MS, amount: d.amount })).filter(d => d.t > 0);
}
/** Bugünden senaryo anına kadar alınan temettü (hisse başı) */
function divsReceived(g: Globals, t0: number): number {
  return g.divs.reduce((a, d) => { const t = exDivMs(d.date); return a + (d.amount > 0 && t > g.now && t <= t0 ? d.amount : 0); }, 0);
}

/** Bacağın hisse başı değeri (hisse için: fiyat + alınan temettü) */
export function legValue(leg: Leg, g: Globals, S: number, date: When, ivShift = 0, quality: Quality = 'full'): number {
  const t0 = valTime(g, date);
  if (leg.kind === 'stock') return S + divsReceived(g, t0);
  const T = Math.max(closeMs(leg.expiry) - t0, 0) / YEAR_MS;
  const iv = Math.max((leg.iv + (ivShift || 0)) / 100, 0.0001);
  return A.americanPrice(leg.kind, S, leg.strike, T, g.r / 100, g.q / 100, iv, cashDivs(g, t0),
    quality === 'fast' ? A.FAST_STEPS : A.DEFAULT_STEPS);
}
export function legTheo(leg: Leg, g: Globals) { return legValue(leg, g, g.S, todayOf(g), 0); }
export function legEntry(leg: Leg, g: Globals): number {
  if (leg.premium != null && isFinite(leg.premium)) return leg.premium;
  return leg.kind === 'stock' ? g.S : legTheo(leg, g);
}
/** Primden Amerikan IV (yüzde). Çözülemezse NaN. */
export function legIV(leg: Leg, g: Globals, premium: number): number {
  if (leg.kind === 'stock') return NaN;
  const t0 = g.now, T = Math.max(closeMs(leg.expiry) - t0, 0) / YEAR_MS;
  return A.americanIV(leg.kind, premium, g.S, leg.strike, T, g.r / 100, g.q / 100, cashDivs(g, t0)) * 100;
}
/** Şu an erken kullanım optimal mi (kısa bacakta atama riski) */
export function legEarly(leg: Leg, g: Globals): boolean {
  if (leg.kind === 'stock') return false;
  const T = yearsLeft(g, todayOf(g), leg.expiry);
  return A.earlyExerciseOptimal(leg.kind, g.S, leg.strike, T, g.r / 100, g.q / 100, Math.max(leg.iv / 100, 1e-4), cashDivs(g, g.now));
}
export function cost(legs: Leg[], g: Globals) { return legs.reduce((a, l) => a + l.side * l.qty * mult(l) * legEntry(l, g), 0); }
export function value(legs: Leg[], g: Globals, S: number, date: When, ivShift = 0, quality: Quality = 'full') {
  return legs.reduce((a, l) => a + l.side * l.qty * mult(l) * legValue(l, g, S, date, ivShift, quality), 0);
}
export function pnl(legs: Leg[], g: Globals, S: number, date: When, ivShift = 0, quality: Quality = 'full') {
  return value(legs, g, S, date, ivShift, quality) - cost(legs, g);
}
export function firstExpiry(legs: Leg[], g: Globals): string {
  const o = optLegs(legs); if (!o.length) return addDays(todayOf(g), 30);
  return o.map(l => l.expiry).sort()[0];
}
export function lastExpiry(legs: Leg[], g: Globals): string {
  const o = optLegs(legs); if (!o.length) return addDays(todayOf(g), 30);
  return o.map(l => l.expiry).sort().pop() as string;
}
export function legGreeks(leg: Leg, g: Globals): A.Greeks {
  const k = leg.side * leg.qty * mult(leg);
  if (leg.kind === 'stock') return { delta: k, gamma: 0, theta: 0, vega: 0, rho: 0 };
  const T = yearsLeft(g, todayOf(g), leg.expiry);
  const gr = A.americanGreeks(leg.kind, g.S, leg.strike, T, g.r / 100, g.q / 100, Math.max(leg.iv / 100, 0.0001), cashDivs(g, g.now));
  return { delta: gr.delta * k, gamma: gr.gamma * k, theta: gr.theta * k, vega: gr.vega * k, rho: gr.rho * k };
}
export function totalGreeks(legs: Leg[], g: Globals): A.Greeks {
  const t: A.Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  legs.forEach(l => {
    const x = legGreeks(l, g);
    (Object.keys(t) as (keyof A.Greeks)[]).forEach(k => { t[k] += x[k]; });
  });
  return t;
}
export function avgIV(legs: Leg[]) {
  const o = optLegs(legs); if (!o.length) return 30;
  const w = o.reduce((a, l) => a + l.qty, 0) || 1;
  return o.reduce((a, l) => a + l.iv * l.qty, 0) / w;
}

// Vade analizi (ilk vade): max kâr/zarar, başabaş noktaları, kâr olasılığı
export function analyze(legs: Leg[], g: Globals): Analysis {
  const exp = firstExpiry(legs, g);
  const strikes = optLegs(legs).map(l => l.strike);
  const top = Math.max(g.S, ...strikes, 1) * 4;
  const later = optLegs(legs).some(l => l.expiry !== exp);
  const tE = closeMs(exp), f = (S: number) => pnl(legs, g, S, tE, 0, later ? 'fast' : 'full');
  const pts = new Set<number>([1e-6, top]); strikes.forEach(k => pts.add(k));
  const NP = later ? 200 : 800;
  for (let i = 1; i < NP; i++) pts.add(top * i / NP);
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
  const T = yearsLeft(g, todayOf(g), exp), sig = avgIV(legs) / 100;
  let pop = 0;
  if (T > 0) {
    // Risk-nötr lognormal; nakit temettüler forward'ı düşürür
    const pv = A.pvDivs(cashDivs(g, g.now), T, g.r / 100);
    const mu = Math.log(Math.max(g.S - pv, 1e-8)) + (g.r / 100 - g.q / 100 - sig * sig / 2) * T, sd = sig * Math.sqrt(T);
    const cdf = (x: number) => x <= 0 ? 0 : ncdf((Math.log(x) - mu) / sd);
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
