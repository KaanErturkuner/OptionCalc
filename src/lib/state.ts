/* Uygulama durumu, hazır stratejiler, kalıcılık */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as St from './strategy.ts';
import type { Leg, Analysis } from './strategy.ts';

export type DateMode = 'today' | 'mid' | 'exp' | 'custom';
export type Unit = 'usd' | 'pct' | 'val';
export interface Scenario { target: number; dateMode: DateMode; date: string | null; ivShift: number }
export interface AppState {
  ticker: string; S: number; r: number; q: number; today: string; range: number; unit: Unit;
  legs: Leg[]; scn: Scenario;
}

const KEY = 'opsiyon-hesaplayici-v1';
let uid = 1;
export const localToday = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const strikeStep = (S: number) => S < 5 ? 0.5 : S < 25 ? 1 : S < 200 ? 5 : S < 1000 ? 10 : 50;
export const roundK = (x: number, S: number) => { const st = strikeStep(S); return +(Math.round(x / st) * st).toFixed(4); };

export function mkLeg(kind: Leg['kind'], side: number, strike: number, expiry: string, iv: number, qty = 1, premium: number | null = null): Leg {
  return { id: uid++, kind, side, strike, expiry, iv, qty, premium };
}
export function defaultState(): AppState {
  const today = localToday();
  return {
    ticker: '', S: 100, r: 4.3, q: 0, today, range: 0, unit: 'usd',
    legs: [mkLeg('call', 1, 100, St.addDays(today, 30), 30)],
    scn: { target: 110, dateMode: 'exp', date: null, ivShift: 0 },
  };
}
function fix(o: any): AppState | null {
  if (!o || !Array.isArray(o.legs)) return null;
  const d = defaultState();
  const s: AppState = { ...d, ...o, scn: { ...d.scn, target: o.S ?? d.S, ...(o.scn || {}) } };
  s.legs = o.legs.map((l: Leg) => ({ ...l, id: uid++, expiry: l.expiry || St.addDays(s.today, 30) }));
  s.today = localToday(); // her açılışta bugünden hesapla
  return s;
}
export async function loadState(): Promise<AppState | null> {
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? fix(JSON.parse(raw)) : null; } catch { return null; }
}
export async function saveState(s: AppState) { try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export async function clearState() { try { await AsyncStorage.removeItem(KEY); } catch {} }

type PresetFn = (S: number, e: string, v: number) => Leg[];
export const PRESETS: [string, PresetFn][] = [
  ['Long Call', (S, e, v) => [mkLeg('call', 1, roundK(S, S), e, v)]],
  ['Long Put', (S, e, v) => [mkLeg('put', 1, roundK(S, S), e, v)]],
  ['Short Put', (S, e, v) => [mkLeg('put', -1, roundK(S * .95, S), e, v)]],
  ['Covered Call', (S, e, v) => [mkLeg('stock', 1, 0, e, v, 100, null), mkLeg('call', -1, roundK(S * 1.05, S), e, v)]],
  ['Bull Call Spread', (S, e, v) => [mkLeg('call', 1, roundK(S, S), e, v), mkLeg('call', -1, roundK(S * 1.05, S), e, v)]],
  ['Bear Put Spread', (S, e, v) => [mkLeg('put', 1, roundK(S, S), e, v), mkLeg('put', -1, roundK(S * .95, S), e, v)]],
  ['Straddle', (S, e, v) => [mkLeg('call', 1, roundK(S, S), e, v), mkLeg('put', 1, roundK(S, S), e, v)]],
  ['Strangle', (S, e, v) => [mkLeg('call', 1, roundK(S * 1.05, S), e, v), mkLeg('put', 1, roundK(S * .95, S), e, v)]],
  ['Iron Condor', (S, e, v) => [mkLeg('put', 1, roundK(S * .9, S), e, v), mkLeg('put', -1, roundK(S * .95, S), e, v),
                                 mkLeg('call', -1, roundK(S * 1.05, S), e, v), mkLeg('call', 1, roundK(S * 1.1, S), e, v)]],
];

export const G = (s: AppState): St.Globals => ({ S: s.S, r: s.r, q: s.q, today: s.today });

export function scnDate(s: AppState): string {
  const g = G(s), exp = St.firstExpiry(s.legs, g), last = St.lastExpiry(s.legs, g), m = s.scn.dateMode;
  let d = m === 'today' ? s.today : m === 'exp' ? exp
    : m === 'mid' ? St.addDays(s.today, Math.round(St.daysBetween(s.today, exp) / 2)) : (s.scn.date || exp);
  if (St.daysBetween(s.today, d) < 0) d = s.today;
  if (St.daysBetween(d, last) < 0) d = last;
  return d;
}

export function priceRange(s: AppState, an: Analysis): [number, number] {
  const S = s.S, ks = St.optLegs(s.legs).map(l => l.strike);
  let lo: number, hi: number;
  if (s.range > 0) { lo = S * (1 - s.range / 100); hi = S * (1 + s.range / 100); }
  else {
    const em = Math.max(an.expectedMove * 2.2, S * 0.08);
    lo = Math.min(S - em, ...ks.map(k => k - em * .35)); hi = Math.max(S + em, ...ks.map(k => k + em * .35));
    lo = Math.min(lo, s.scn.target * 0.97); hi = Math.max(hi, s.scn.target * 1.03);
  }
  return [Math.max(lo, S * 0.01), hi];
}
