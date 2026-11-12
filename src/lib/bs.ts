/* Black-Scholes-Merton motoru (web sürümündeki bs.js'in TS portu) */
export type OptType = 'call' | 'put';
export interface Greeks { delta: number; gamma: number; theta: number; vega: number; rho: number }

const SQRT2PI = Math.sqrt(2 * Math.PI);

// Yüksek hassasiyetli normal CDF (Hart / West, ~1e-15)
export function ncdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) c = 0;
  else {
    const e = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-02 * z + 0.700383064443688;
      n = n * z + 6.37396220353165; n = n * z + 33.912866078383;
      n = n * z + 112.079291497871; n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-02 * z + 1.75566716318264;
      d = d * z + 16.064177579207; d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674; d = d * z + 637.333633378831;
      d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      c = e * n / d;
    } else {
      let b = z + 0.65; b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}
export const npdf = (x: number) => Math.exp(-x * x / 2) / SQRT2PI;

// T yıl; r,q,sigma ondalık (0.05)
export function price(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) {
    const fwdS = S * Math.exp(-q * Math.max(T, 0)), dK = K * Math.exp(-r * Math.max(T, 0));
    return type === 'call' ? Math.max(fwdS - dK, 0) : Math.max(dK - fwdS, 0);
  }
  const sT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / sT, d2 = d1 - sT;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  return type === 'call' ? S * dq * ncdf(d1) - K * dr * ncdf(d2)
                         : K * dr * ncdf(-d2) - S * dq * ncdf(-d1);
}

// theta günlük (takvim günü), vega IV +1 puan, rho faiz +1 puan
export function greeks(type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number): Greeks {
  if (T <= 0 || sigma <= 0) {
    const itm = type === 'call' ? S > K : S < K;
    return { delta: itm ? (type === 'call' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sq = Math.sqrt(T), sT = sigma * sq;
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / sT, d2 = d1 - sT;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T), pd = npdf(d1);
  const gamma = dq * pd / (S * sT);
  const vega = S * dq * pd * sq / 100;
  let delta: number, theta: number, rho: number;
  if (type === 'call') {
    delta = dq * ncdf(d1);
    theta = -S * dq * pd * sigma / (2 * sq) - r * K * dr * ncdf(d2) + q * S * dq * ncdf(d1);
    rho = K * T * dr * ncdf(d2) / 100;
  } else {
    delta = -dq * ncdf(-d1);
    theta = -S * dq * pd * sigma / (2 * sq) + r * K * dr * ncdf(-d2) - q * S * dq * ncdf(-d1);
    rho = -K * T * dr * ncdf(-d2) / 100;
  }
  return { delta, gamma, theta: theta / 365, vega, rho };
}

// Piyasa fiyatından implied volatility (Newton + bisection yedeği)
export function impliedVol(type: OptType, mkt: number, S: number, K: number, T: number, r: number, q: number): number {
  if (!(T > 0) || !(mkt > 0)) return NaN;
  const lo0 = price(type, S, K, T, r, q, 1e-6), hi0 = price(type, S, K, T, r, q, 5);
  if (mkt <= lo0 + 1e-10 || mkt >= hi0) return NaN;
  let lo = 1e-6, hi = 5, s = 0.3;
  for (let i = 0; i < 100; i++) {
    const p = price(type, S, K, T, r, q, s), diff = p - mkt;
    if (Math.abs(diff) < 1e-9) return s;
    if (diff > 0) hi = s; else lo = s;
    const v = greeks(type, S, K, T, r, q, s).vega * 100;
    let ns = v > 1e-10 ? s - diff / v : NaN;
    if (!(ns > lo && ns < hi)) ns = (lo + hi) / 2;
    s = ns;
  }
  return s;
}
