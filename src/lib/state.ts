/* Uygulama durumu, hazır stratejiler, kalıcılık — ABD (Amerikan tipi) */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as St from './strategy.ts';
import type { Leg, Analysis, Div } from './strategy.ts';
import { addDaysStr, closeMs, defaultExpiry, etDate, expirations } from './usmarket.ts';
import type { Chain, ProviderId, Quote } from './market/types.ts';
import { mid, nearest } from './market/index.ts';

export type DateMode = 'today' | 'mid' | 'exp' | 'custom';
export interface Scenario { target: number; dateMode: DateMode; date: string | null; ivShift: number }
export type StratId = 'longCall' | 'longPut' | 'coveredCall' | 'csp' | 'bullCall' | 'bearPut' | 'ironCondor' | 'straddle' | 'custom';
export interface AppState {
  ticker: string; S: number;
  r: number; q: number;                       // yüzde
  divAmt: number; divDate: string | null; divRepeat: boolean; // sonraki nakit temettü (hisse başı $), çeyreklik tekrar
  strat: StratId; expiry: string; contracts: number; iv: number;
  autoStrikes: boolean;                        // strike'lar fiyatı takip etsin mi (elle değiştirilene kadar)
  legs: Leg[]; scn: Scenario;
  now: number; today: string;                  // ET
  // piyasa verisi
  provider: 'auto' | ProviderId; apiKey: string; flowKey: string; quote: Quote | null; src: ProviderId | null; marketExps: string[];
  /** Fiyat × Tarih tablosu: adım ($, null = otomatik), aralık (±% veya elle min/max; null = otomatik) */
  tbl: TableCfg;
}
export interface TableCfg { step: number | null; pct: number | null; lo: number | null; hi: number | null }
export const DEFAULT_TBL: TableCfg = { step: null, pct: null, lo: null, hi: null };
/** Tablo satır sınırı (performans) */
export const MAX_ROWS = 60;
/**
 * Tablo fiyat satırları: aralık [lo,hi] (±% → S etrafında, elle min/max, yoksa grafik aralığı) ve adım (yoksa ~16 satır).
 * Adım çok küçükse satır sayısı MAX_ROWS'u aşmasın diye büyütülür. Şimdiki fiyat ve hedef her zaman eklenir.
 */
export function tableRows(S: number, target: number, auto: [number, number], c: TableCfg): { prices: number[]; step: number; lo: number; hi: number; capped: boolean } {
  let lo = auto[0], hi = auto[1];
  if (c.pct != null && c.pct > 0) { lo = S * (1 - c.pct / 100); hi = S * (1 + c.pct / 100); }
  else if (c.lo != null && c.hi != null && c.hi > c.lo && c.lo > 0) { lo = c.lo; hi = c.hi; }
  lo = Math.max(lo, 0.01);
  let step: number;
  if (c.step != null && c.step > 0) step = c.step;
  else {
    const step0 = (hi - lo) / 16, mag = Math.pow(10, Math.floor(Math.log10(step0))), f = step0 / mag;
    step = (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7 ? 5 : 10) * mag;
  }
  let capped = false;
  if ((hi - lo) / step > MAX_ROWS) { capped = true; const k = Math.ceil((hi - lo) / step / MAX_ROWS); step = +(step * k).toFixed(6); }
  const prices: number[] = [];
  for (let p = Math.floor(hi / step + 1e-9) * step; p >= lo - 1e-9; p -= step) prices.push(+p.toFixed(6));
  [S, target].forEach(x => { if (x >= lo - step && x <= hi + step && !prices.some(p => Math.abs(p - x) < 1e-6)) prices.push(x); });
  prices.sort((a, b) => b - a);
  return { prices, step, lo, hi, capped };
}

export const DEFAULT_RATE = 4.2; // 3 aylık T-bill (Kasım 2026 ≈ %4,1–4,2)
const KEY = 'opsiyon-abd-v2';
let uid = 1;

/** ABD strike aralığı (yaklaşık) */
export const strikeStep = (S: number) => S < 25 ? 0.5 : S < 200 ? 1 : S < 500 ? 2.5 : S < 1000 ? 5 : 10;
export const roundK = (x: number, S: number) => { const st = strikeStep(S); return +(Math.round(x / st) * st).toFixed(4); };
/** Hisse/hedef fiyatı −/+ adımı: 1 $ (10 $ altı hisselerde 0,10 $) */
export const priceStep = (S: number) => S < 10 ? 0.1 : 1;

export function mkLeg(kind: Leg['kind'], side: number, strike: number, expiry: string, iv: number, qty = 1, premium: number | null = null): Leg {
  return { id: uid++, kind, side, strike, expiry, iv, qty, premium };
}

export const STRATS: { id: StratId; name: string; sub: string }[] = [
  { id: 'longCall', name: 'Long Call', sub: 'Yükseliş' },
  { id: 'longPut', name: 'Long Put', sub: 'Düşüş' },
  { id: 'coveredCall', name: 'Covered Call', sub: '100 hisse + satılan call' },
  { id: 'csp', name: 'Cash-Secured Put', sub: 'Put sat, prim topla' },
  { id: 'bullCall', name: 'Bull Call Spread', sub: 'Sınırlı yükseliş' },
  { id: 'bearPut', name: 'Bear Put Spread', sub: 'Sınırlı düşüş' },
  { id: 'ironCondor', name: 'Iron Condor', sub: 'Yatay piyasa' },
  { id: 'straddle', name: 'Straddle', sub: 'Büyük hareket' },
  { id: 'custom', name: 'Özel', sub: 'Bacakları kendin kur' },
];
export const stratName = (id: StratId) => STRATS.find(x => x.id === id)?.name || 'Özel';

/** Hazır stratejinin bacakları (n kontrat) */
export function buildLegs(id: StratId, S: number, e: string, v: number, n: number): Leg[] {
  const K = (m: number) => roundK(S * m, S);
  switch (id) {
    case 'longCall': return [mkLeg('call', 1, K(1), e, v, n)];
    case 'longPut': return [mkLeg('put', 1, K(1), e, v, n)];
    case 'coveredCall': return [mkLeg('stock', 1, 0, e, 0, 100 * n, null), mkLeg('call', -1, K(1.05), e, v, n)];
    case 'csp': return [mkLeg('put', -1, K(0.95), e, v, n)];
    case 'bullCall': return [mkLeg('call', 1, K(1), e, v, n), mkLeg('call', -1, K(1.05), e, v, n)];
    case 'bearPut': return [mkLeg('put', 1, K(1), e, v, n), mkLeg('put', -1, K(0.95), e, v, n)];
    case 'ironCondor': return [mkLeg('put', 1, K(0.9), e, v, n), mkLeg('put', -1, K(0.95), e, v, n),
                               mkLeg('call', -1, K(1.05), e, v, n), mkLeg('call', 1, K(1.1), e, v, n)];
    case 'straddle': return [mkLeg('call', 1, K(1), e, v, n), mkLeg('put', 1, K(1), e, v, n)];
    default: return [mkLeg('call', 1, K(1), e, v, n)];
  }
}

export function defaultState(now = Date.now()): AppState {
  const expiry = defaultExpiry(now);
  return {
    ticker: '', S: 100, r: DEFAULT_RATE, q: 0, divAmt: 0, divDate: null, divRepeat: true,
    strat: 'longCall', expiry, contracts: 1, iv: 30, autoStrikes: true,
    legs: buildLegs('longCall', 100, expiry, 30, 1),
    scn: { target: 110, dateMode: 'exp', date: null, ivShift: 0 },
    now, today: etDate(now),
    provider: 'auto', apiKey: '', flowKey: '', quote: null, src: null, marketExps: [],
    tbl: { ...DEFAULT_TBL },
  };
}
function fix(o: any): AppState | null {
  if (!o || !Array.isArray(o.legs)) return null;
  const now = Date.now(), d = defaultState(now);
  delete o.mdKey; // eski sürüm: MarketData tokenı telefonda saklanıyordu → artık yok (sunucuda)
  const s: AppState = { ...d, ...o, scn: { ...d.scn, ...(o.scn || {}) }, tbl: { ...DEFAULT_TBL, ...(o.tbl || {}) }, now, today: etDate(now) };
  s.legs = o.legs.map((l: Leg) => ({ ...l, id: uid++ }));
  // vadesi geçmiş bacakları en yakın vadeye taşı
  const first = expirations(now)[0]?.date || d.expiry;
  s.legs.forEach(l => { if (closeMs(l.expiry) <= now) l.expiry = first; });
  if (closeMs(s.expiry) <= now) s.expiry = d.expiry;
  s.marketExps = (s.marketExps || []).filter(e => closeMs(e) > now);
  return s;
}
export async function loadState(): Promise<AppState | null> {
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? fix(JSON.parse(raw)) : null; } catch { return null; }
}
export async function saveState(s: AppState) { try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export async function clearState() { try { await AsyncStorage.removeItem(KEY); } catch {} }

/** Temettü listesi: girilen ex-tarih (+ çeyreklik tekrar, ~91 gün, 3 yıla kadar) */
export function divList(s: AppState): Div[] {
  if (!(s.divAmt > 0) || !s.divDate) return [];
  const out: Div[] = [];
  for (let i = 0, d = s.divDate; i < (s.divRepeat ? 12 : 1); i++, d = addDaysStr(d, 91)) out.push({ date: d, amount: s.divAmt });
  return out;
}
export const G = (s: AppState): St.Globals => ({ S: s.S, r: s.r, q: s.q, divs: divList(s), now: s.now });

/** Senaryo tarihi (YYYY-MM-DD) */
export function scnDate(s: AppState): string {
  const g = G(s), exp = St.firstExpiry(s.legs, g), last = St.lastExpiry(s.legs, g), m = s.scn.dateMode;
  let d = m === 'today' ? s.today : m === 'exp' ? exp
    : m === 'mid' ? St.addDays(s.today, Math.round(St.daysBetween(s.today, exp) / 2)) : (s.scn.date || exp);
  if (St.daysBetween(s.today, d) < 0) d = s.today;
  if (St.daysBetween(d, last) < 0) d = last;
  return d;
}
/** Senaryo değerleme anı: vade günü ve sonrası → 16:00 ET kapanış, bugün → şu an */
export function scnWhen(s: AppState, d: string, exp: string): St.When {
  return d >= exp ? closeMs(d) : d;
}

export function priceRange(s: AppState, an: Analysis): [number, number] {
  const S = s.S, ks = St.optLegs(s.legs).map(l => l.strike);
  const em = Math.max(an.expectedMove * 2.2, S * 0.08);
  let lo = Math.min(S - em, ...ks.map(k => k - em * .35)), hi = Math.max(S + em, ...ks.map(k => k + em * .35));
  lo = Math.min(lo, s.scn.target * 0.97); hi = Math.max(hi, s.scn.target * 1.03);
  return [Math.max(lo, S * 0.01), hi];
}

/**
 * Zinciri bacaklara uygula. mode 'snap': otomatik/canlı bacakları en yakın gerçek strike'a oturt + mid prim + kendi Amerikan IV'miz;
 * 'refresh': sadece canlı bacakların primini/IV'sini aynı strike'ta güncelle.
 */
export function applyChain(d: AppState, ch: Chain, mode: 'snap' | 'refresh') {
  const g = G(d);
  d.legs = d.legs.map(l => {
    if (l.kind === 'stock' || l.expiry !== ch.expiry) return l;
    const list = l.kind === 'call' ? ch.calls : ch.puts;
    const canSnap = mode === 'snap' && (l.live || (d.autoStrikes && d.strat !== 'custom') || l.premium == null);
    if (!canSnap && !(mode === 'refresh' && l.live)) return l;
    const o = canSnap ? nearest(list, l.strike) : list.find(x => Math.abs(x.strike - l.strike) < 1e-9) || null;
    if (!o) return l;
    return fillFromQuote(l, o, g);
  });
}
/** Kontrattan bacak: strike, mid prim, IV (önce kendi Amerikan IV'miz, olmazsa sağlayıcınınki) */
export function fillFromQuote(l: Leg, o: { strike: number; bid: number; ask: number; last: number; iv: number | null; type: 'call' | 'put' }, g: St.Globals): Leg {
  const p = +mid(o as any).toFixed(2);
  const nl: Leg = { ...l, strike: o.strike, premium: p > 0 ? p : null, live: p > 0 };
  if (p > 0) {
    const v = St.legIV(nl, g, p);
    if (isFinite(v)) nl.iv = +v.toFixed(2); else if (o.iv) nl.iv = +(o.iv * 100).toFixed(2);
  } else if (o.iv) nl.iv = +(o.iv * 100).toFixed(2);
  return nl;
}
