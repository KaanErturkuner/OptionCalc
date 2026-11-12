/*
 * Amerikan tipi opsiyon fiyatlama motoru (ABD hisse/ETF opsiyonları)
 * - Leisen-Reimer binom ağacı (tek sayılı adım, Peizer-Pratt inversiyonu) + Avrupa kontrol değişkeni
 * - Sürekli temettü verimi (q) ve nakit temettüler (ex-tarih + tutar; "escrowed dividend" modeli, Hull)
 * - Erken kullanım her düğümde kontrol edilir
 * - Greek'ler Amerikan fiyat üzerinden sonlu farklarla, IV Brent yöntemiyle Amerikan fiyattan çözülür
 */
import * as BS from './bs.ts';

export type OptType = 'call' | 'put';
/** t: değerleme anından ex-temettü anına yıl; amount: hisse başı $ */
export interface CashDiv { t: number; amount: number }
export interface Greeks { delta: number; gamma: number; theta: number; vega: number; rho: number }
export interface TreeResult { american: number; european: number }

export const DEFAULT_STEPS = 151;
/** Grafik/tablo gibi yüzlerce noktanın hesaplandığı yerler için hızlı ayar */
export const FAST_STEPS = 41;

const intrinsic = (type: OptType, S: number, K: number) => Math.max(type === 'call' ? S - K : K - S, 0);

/** Peizer-Pratt inversiyonu (yöntem 2) */
function pp(z: number, n: number): number {
  const a = z / (n + 1 / 3 + 0.1 / (n + 1));
  return 0.5 + Math.sign(z) * 0.5 * Math.sqrt(1 - Math.exp(-a * a * (n + 1 / 6)));
}

function liveDivs(divs: CashDiv[] | undefined, T: number): CashDiv[] {
  return (divs || []).filter(d => d.amount > 0 && d.t > 0 && d.t < T);
}
/** Vadeye kadar ödenecek temettülerin bugünkü değeri */
export function pvDivs(divs: CashDiv[] | undefined, T: number, r: number): number {
  return liveDivs(divs, T).reduce((a, d) => a + d.amount * Math.exp(-r * d.t), 0);
}

/**
 * Ham binom ağacı. method 'lr' = Leisen-Reimer (varsayılan), 'crr' = Cox-Ross-Rubinstein.
 * Aynı ağaçta hem Amerikan hem Avrupa değeri hesaplanır.
 */
export function tree(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number,
  divs: CashDiv[] = [], steps = DEFAULT_STEPS, method: 'lr' | 'crr' = 'lr'): TreeResult {
  const ds = liveDivs(divs, T);
  const Sx = Math.max(S - ds.reduce((a, d) => a + d.amount * Math.exp(-r * d.t), 0), 1e-8); // escrowed spot
  let n = Math.max(1, Math.round(steps));
  if (method === 'lr' && n % 2 === 0) n += 1;
  const dt = T / n, b = r - q, disc = Math.exp(-r * dt), growth = Math.exp(b * dt);
  let u: number, d: number, p: number;
  if (method === 'lr') {
    const sT = sigma * Math.sqrt(T);
    const d1 = (Math.log(Sx / K) + (b + sigma * sigma / 2) * T) / sT, d2 = d1 - sT;
    p = pp(d2, n); const p1 = pp(d1, n);
    u = growth * p1 / p; d = (growth - p * u) / (1 - p);
    if (!(p > 0 && p < 1 && d > 0 && u > d)) return tree(type, S, K, T, r, q, sigma, divs, steps, 'crr');
  } else {
    u = Math.exp(sigma * Math.sqrt(dt)); d = 1 / u; p = (growth - d) / (u - d);
    p = Math.min(Math.max(p, 0), 1);
  }
  const pu = disc * p, pd = disc * (1 - p), ud = u / d;
  const isCall = type === 'call';
  const A = new Float64Array(n + 1), E = new Float64Array(n + 1);
  let s = Sx * Math.pow(d, n);
  for (let j = 0; j <= n; j++) { const v = isCall ? s - K : K - s; A[j] = E[j] = v > 0 ? v : 0; s *= ud; }
  for (let i = n - 1; i >= 0; i--) {
    const t = i * dt;
    let add = 0; // bu düğümden sonra ödenecek temettülerin o andaki değeri
    for (const dv of ds) if (dv.t > t) add += dv.amount * Math.exp(-r * (dv.t - t));
    let sn = Sx * Math.pow(d, i);
    for (let j = 0; j <= i; j++) {
      E[j] = pu * E[j + 1] + pd * E[j];
      const cont = pu * A[j + 1] + pd * A[j];
      const Sn = sn + add, ex = isCall ? Sn - K : K - Sn;
      A[j] = ex > cont ? ex : cont;
      sn *= ud;
    }
  }
  return { american: A[0], european: E[0] };
}

/** Escrowed-dividend Black-Scholes-Merton (ağacın Avrupa karşılığı, kontrol değişkeni) */
export function europeanPrice(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number, divs: CashDiv[] = []): number {
  return BS.price(type, Math.max(S - pvDivs(divs, T, r), 1e-8), K, T, r, q, sigma);
}

const cache = new Map<string, number>();
/** Erken kullanımın hiç optimal olmadığı durum: temettüsüz call (r ≥ 0) → Avrupa = Amerikan */
const noEarlyExercise = (type: OptType, r: number, q: number, ds: CashDiv[]) => type === 'call' && q <= 0 && r >= 0 && ds.length === 0;

/** Amerikan opsiyon fiyatı (hisse başı $). T yıl; r, q, sigma ondalık. */
export function americanPrice(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number,
  divs: CashDiv[] = [], steps = DEFAULT_STEPS): number {
  if (!(S > 0) || !(K > 0)) return 0;
  const iv0 = intrinsic(type, S, K);
  if (!(T > 1e-9)) return iv0;
  sigma = Math.max(sigma, 1e-4);
  const ds = liveDivs(divs, T);
  if (noEarlyExercise(type, r, q, ds)) return BS.price(type, S, K, T, r, q, sigma);
  const key = `${type}|${S}|${K}|${T}|${r}|${q}|${sigma}|${steps}|${ds.map(d => d.t + ':' + d.amount).join(',')}`;
  const hit = cache.get(key); if (hit !== undefined) return hit;
  // Leisen-Reimer + kontrol değişkeni, iki ağaçla Richardson ekstrapolasyonu (hata ~1/n → n ile m'den V)
  const eu = europeanPrice(type, S, K, T, r, q, sigma, ds);
  const one = (k: number) => { const tr = tree(type, S, K, T, r, q, sigma, ds, k, 'lr'); return tr.american + (eu - tr.european); };
  let n = Math.max(3, Math.round(steps)); if (n % 2 === 0) n += 1;
  let m = Math.floor(n / 2); if (m % 2 === 0) m += 1;
  const pn = one(n), pm = one(m);
  const v = Math.max((n * pn - m * pm) / (n - m), iv0);
  if (cache.size > 40000) cache.clear();
  cache.set(key, v);
  return v;
}

/** Greek'ler (sonlu fark): delta, gamma; theta = 1 takvim günü; vega = IV +1 puan; rho = faiz +1 puan */
export function americanGreeks(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number,
  divs: CashDiv[] = [], steps = DEFAULT_STEPS): Greeks {
  if (!(T > 1e-9) || !(S > 0)) {
    const itm = type === 'call' ? S > K : S < K;
    return { delta: itm ? (type === 'call' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  sigma = Math.max(sigma, 1e-4);
  const ds = liveDivs(divs, T);
  if (noEarlyExercise(type, r, q, ds)) return BS.greeks(type, S, K, T, r, q, sigma);
  const P = (s: number, t: number, v: number, rr: number, dv: CashDiv[] = ds) => americanPrice(type, s, K, t, rr, q, v, dv, steps);
  const p0 = P(S, T, sigma, r);
  const h = S * 0.01;
  const up = P(S + h, T, sigma, r), dn = P(S - h, T, sigma, r);
  const delta = (up - dn) / (2 * h), gamma = (up - 2 * p0 + dn) / (h * h);
  const day = 1 / 365, Tn = T - day;
  const theta = Tn > 1e-9 ? P(S, Tn, sigma, r, ds.map(x => ({ t: x.t - day, amount: x.amount }))) - p0 : intrinsic(type, S, K) - p0;
  const dv = Math.min(0.01, sigma / 2);
  const vega = (P(S, T, sigma + dv, r) - P(S, T, sigma - dv, r)) / (2 * dv) / 100;
  const dr = 0.001;
  const rho = (P(S, T, sigma, r + dr) - P(S, T, sigma, r - dr)) / (2 * dr) / 100;
  return { delta, gamma, theta, vega, rho };
}

/**
 * Amerikan fiyattan implied volatility (Brent). Prim içsel değerin altındaysa veya %500 IV'yi aşıyorsa NaN.
 */
export function americanIV(type: OptType, mkt: number, S: number, K: number, T: number, r: number, q: number,
  divs: CashDiv[] = []): number {
  if (!(T > 1e-9) || !(mkt > 0) || !(S > 0) || !(K > 0)) return NaN;
  const f = (v: number) => americanPrice(type, S, K, T, r, q, v, divs) - mkt;
  let a = 0.001, b = 5, fa = f(a), fb = f(b);
  if (fa > 0) return Math.abs(fa) < 1e-4 ? a : NaN;   // prim, sıfır volatilitedeki değerin (≈içsel) altında
  if (fb < 0) return NaN;
  if (fa === 0) return a;
  let c = a, fc = fa, dd = b - a, e = dd;
  for (let i = 0; i < 100; i++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) { c = a; fc = fa; dd = b - a; e = dd; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 2e-12 * Math.abs(b) + 1e-9, m = (c - b) / 2;
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa; let P: number, Q: number;
      if (a === c) { P = 2 * m * s; Q = 1 - s; }
      else { const qq = fa / fc, rr = fb / fc; P = s * (2 * m * qq * (qq - rr) - (b - a) * (rr - 1)); Q = (qq - 1) * (rr - 1) * (s - 1); }
      if (P > 0) Q = -Q; else P = -P;
      if (2 * P < Math.min(3 * m * Q - Math.abs(tol * Q), Math.abs(e * Q))) { e = dd; dd = P / Q; } else { dd = m; e = dd; }
    } else { dd = m; e = dd; }
    a = b; fa = fb;
    b += Math.abs(dd) > tol ? dd : (m > 0 ? tol : -tol);
    fb = f(b);
  }
  return b;
}

/** Bugün kullanmak optimal mi? (Amerikan değer ≈ içsel değer → atama/erken kullanım riski) */
export function earlyExerciseOptimal(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number, divs: CashDiv[] = []): boolean {
  const iv0 = intrinsic(type, S, K);
  if (!(iv0 > 0) || !(T > 1e-9)) return false;
  return americanPrice(type, S, K, T, r, q, sigma, divs) - iv0 < 0.005;
}
