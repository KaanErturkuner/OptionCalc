/* Aşama A — Zımni olasılık motoru (risk-nötr). Opsiyon fiyatlarından kapanış olasılığı, dokunma olasılığı ve skew metrikleri.
   Saf TS (src/lib kuralı): React / Node yerleşiği yok. Gerçek dünya olasılığı DEĞİL; piyasanın fiyatladığı olasılık.
   Risk-nötr olduğu için düşüş olasılığını biraz abartır. */
import { ncdf, npdf, impliedVol } from '../bs.ts';
import type { Chain } from '../market/types.ts';
import { mid, spreadPct } from '../market/types.ts';

export interface SmilePt { K: number; x: number; iv: number } // x = ln(K/F)
export interface Smile { S: number; T: number; r: number; q: number; F: number; pts: SmilePt[] }
export interface SmileOpts { maxSpread?: number; minMid?: number }

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const med3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/** Ham (K, iv) noktalarından pürüzsüz smile: ln(K/F) sıralı, 3'lü hareketli medyan, uçlar korunur. */
export function makeSmile(S: number, T: number, r: number, q: number, raw: { K: number; iv: number }[]): Smile {
  const F = S * Math.exp((r - q) * T);
  const byK = new Map<number, number[]>();
  for (const p of raw) if (p.K > 0 && p.iv > 0 && isFinite(p.iv)) { const a = byK.get(p.K) ?? []; a.push(p.iv); byK.set(p.K, a); }
  let pts: SmilePt[] = [...byK].map(([K, ivs]) => ({ K, x: Math.log(K / F), iv: ivs.reduce((s, v) => s + v, 0) / ivs.length }))
    .sort((a, b) => a.x - b.x);
  if (pts.length >= 3) {
    const iv = pts.map(p => p.iv);
    pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { ...p, iv: med3(iv[i - 1], iv[i], iv[i + 1]) }));
  }
  return { S, T, r, q, F, pts };
}

/** Zincirden smile: yalnız OTM taraf (K<F put, K≥F call), bid>0, spread ≤ maxSpread, mid ≥ minMid.
 *  IV sağlayıcıdan gelirse o kullanılır, yoksa impliedVol(mid). */
export function buildSmile(ch: Chain, S: number, T: number, r: number, q = 0, o: SmileOpts = {}): Smile {
  const F = S * Math.exp((r - q) * T), maxSp = o.maxSpread ?? 0.35, minMid = o.minMid ?? 0.05;
  const raw: { K: number; iv: number }[] = [];
  const take = (list: Chain['calls'], type: 'call' | 'put') => {
    for (const x of list) {
      if (type === 'call' ? x.strike < F : x.strike >= F) continue;
      if (!(x.bid > 0) || spreadPct(x) > maxSp) continue;
      const m = mid(x);
      if (!(m >= minMid)) continue;
      const iv = x.iv != null && x.iv > 0 ? x.iv : impliedVol(type, m, S, x.strike, T, r, q);
      if (isFinite(iv) && iv > 0.001 && iv < 5) raw.push({ K: x.strike, iv });
    }
  };
  take(ch.calls, 'call');
  take(ch.puts, 'put');
  return makeSmile(S, T, r, q, raw);
}

/** σ(K): ln(K/F) ekseninde doğrusal interpolasyon, uçlarda düz ekstrapolasyon. */
export function ivAt(sm: Smile, K: number): number {
  const p = sm.pts;
  if (!p.length) return NaN;
  const x = Math.log(K / sm.F);
  if (x <= p[0].x) return p[0].iv;
  if (x >= p[p.length - 1].x) return p[p.length - 1].iv;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].x <= x) lo = m; else hi = m; }
  const a = p[lo], b = p[hi];
  return a.iv + (x - a.x) / (b.x - a.x) * (b.iv - a.iv);
}

/** P(S_T > K), risk-nötr. Breeden–Litzenberger + skew düzeltmesi: N(d2) − e^{rT}·vega·∂σ/∂K, [0,1]'e kırpılır. */
export function pAbove(sm: Smile, K: number): number {
  const sig = ivAt(sm, K);
  if (!(sig > 0)) return NaN;
  const h = Math.max(K * 1e-3, 0.01);
  const dSig = (ivAt(sm, K + h) - ivAt(sm, K - h)) / (2 * h);
  const { S, T, r, q } = sm, sT = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sig * sig / 2) * T) / sT, d2 = d1 - sT;
  const vega = S * Math.exp(-q * T) * npdf(d1) * Math.sqrt(T); // ham vega (σ birimi başına)
  return clamp01(ncdf(d2) - Math.exp(r * T) * vega * dSig);
}

/** P(S_T ≤ K) */
export function pBelow(sm: Smile, K: number): number {
  const p = pAbove(sm, K);
  return isNaN(p) ? NaN : 1 - p;
}

/** K1 < K2 için P(K1 < S_T ≤ K2) */
export function pBetween(sm: Smile, K1: number, K2: number): number {
  return clamp01(pAbove(sm, K1) - pAbove(sm, K2));
}

/** Dokunma (YAKLAŞIK): P ≈ min(1, 2 · P(ufuk dışı)). Ufuk: K spot'un üstündeyse yukarı, altındaysa aşağı. */
export function pTouch(sm: Smile, K: number): number {
  return Math.min(1, 2 * (K > sm.S ? pAbove(sm, K) : pBelow(sm, K)));
}

/** P(S_T ≤ q) = p olan K (ikiye bölme). */
export function quantile(sm: Smile, p: number): number {
  const sig = ivAt(sm, sm.F), w = 6 * sig * Math.sqrt(sm.T) + 1e-9;
  let lo = sm.F * Math.exp(-w), hi = sm.F * Math.exp(w);
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (pAbove(sm, m) > 1 - p) lo = m; else hi = m; // P(S_T ≤ m) < p → K'yi artır
  }
  return (lo + hi) / 2;
}

/** Çapraz kontrol (skew'siz): komşu likit call'lardan P(S_T>K) ≈ e^{rT}(C1 − C2)/(K2 − K1). Komşu yoksa null. */
export function crossCheck(ch: Chain, K: number, T: number, r: number, o: SmileOpts = {}): number | null {
  const maxSp = o.maxSpread ?? 0.35, minMid = o.minMid ?? 0.05;
  const liq = ch.calls
    .filter(c => c.bid > 0 && spreadPct(c) <= maxSp && mid(c) >= minMid)
    .sort((a, b) => a.strike - b.strike);
  const i = liq.findIndex(c => c.strike > K);
  if (i <= 0) return null;
  const a = liq[i - 1], b = liq[i];
  return clamp01(Math.exp(r * T) * (mid(a) - mid(b)) / (b.strike - a.strike));
}

/** |delta| = absD olan K (smile tutarlı delta: e^{-qT}·N(±d1), σ = σ(K)). */
export function strikeForDelta(sm: Smile, type: 'call' | 'put', absD: number): number {
  const sig0 = ivAt(sm, sm.F), w = 6 * sig0 * Math.sqrt(sm.T) + 1e-9;
  const dq = Math.exp(-sm.q * sm.T);
  const delta = (K: number) => {
    const s = ivAt(sm, K), sT = s * Math.sqrt(sm.T);
    const d1 = (Math.log(sm.S / K) + (sm.r - sm.q + s * s / 2) * sm.T) / sT;
    return type === 'call' ? dq * ncdf(d1) : dq * ncdf(-d1);
  };
  // call |Δ| K arttıkça düşer; put |Δ| K arttıkça artar
  let lo = sm.F * Math.exp(-w), hi = sm.F * Math.exp(w);
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2, v = delta(m) - absD;
    if ((v > 0) === (type === 'call')) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

export interface SkewMetrics { atm: number; k25P: number; k25C: number; iv25P: number; iv25C: number; rr25: number; putWing: number }

/** 25Δ risk reversal (σ25ΔP − σ25ΔC) ve put kanadı eğimi ((σ25P − σATM) / |ln(K25P/F)|). */
export function skew(sm: Smile): SkewMetrics {
  const atm = ivAt(sm, sm.F);
  const k25P = strikeForDelta(sm, 'put', 0.25), k25C = strikeForDelta(sm, 'call', 0.25);
  const iv25P = ivAt(sm, k25P), iv25C = ivAt(sm, k25C);
  const lx = Math.log(k25P / sm.F);
  return { atm, k25P, k25C, iv25P, iv25C, rr25: iv25P - iv25C, putWing: lx < 0 ? (iv25P - atm) / -lx : NaN };
}
