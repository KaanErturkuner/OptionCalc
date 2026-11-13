/* Qullamaggie günlük bağlam (saf): EMA, ATR%, göreli güç (SPY'ye karşı), konsolidasyon, uzama, hacim, Q-kalite.
 * Qullamaggie uyarlaması — Kaan onayı yok. Girdi: DailyBar[] (bugün HARİÇ, kronolojik). Ağ ve Node'a özgü bağımlılık yok.
 * Sabitler ve kalite formülü bu dosyanın başında tek yerde. */

export interface DailyBar { D: string; o: number; h: number; l: number; c: number; v: number }

/** Sabitler. Qullamaggie uyarlaması — Kaan onayı yok. */
export const QD = {
  EMA_FAST: 10, EMA_SLOW: 20, SLOPE_DAYS: 5,           // trend: close > EMA10 > EMA20, EMA20 eğimi (5 gün) > 0
  ATR_N: 14,                                           // ATR (basit ortalama, 14 gün)
  RS_SHORT: 21, RS_LONG: 63,                           // göreli güç pencereleri (işlem günü)
  CONSOL_RECENT: 5, CONSOL_BASE: 20,                   // daralma: son 5 gün ort. aralık / önceki 20 gün ort. aralık
  CONTRACTION_MAX: 0.8,                                // Q1 eşiği
  NEAR_FRAC: 0.9,                                      // yakın tepe: close ≥ 0,9 × 63g yüksek (dip: close ≤ 1,1 × 63g düşük)
  MIN_BARS: 26,                                        // EMA20 + 5 gün eğim için asgari geçmiş
  AVG_VOL_N: 20,                                       // Q2 hacim referansı
  Q_RS_SCALE: 0.2, Q_MOVE_SCALE: 0.6,                  // kalite: |RS63| 0,2 ve |getiri63| 0,6'da tam puan
  W_MOVE: 30, W_RS: 25, W_CONTRACT: 20, W_NEAR: 15,    // kalite ağırlıkları (toplam 90; SPY yoksa RS 25 puanı boş kalır)
  W_EXTRA: 10,                                         // kalite: 21g ve 63g getiri aynı yönde ise ek 10 puan (toplam 100)
} as const;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

/** Üstel hareketli ortalama (ilk değer n günlük basit ortalama). İlk n−1 değer NaN. */
export function ema(xs: number[], n: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  if (n < 1 || xs.length < n) return out;
  const k = 2 / (n + 1);
  let prev = mean(xs.slice(0, n));
  out[n - 1] = prev;
  for (let i = n; i < xs.length; i++) { prev = xs[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** Gerçek aralık serisi (ilk gün: h − l). */
export function trueRange(bars: DailyBar[]): number[] {
  return bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
}

/** ATR (son n günün gerçek aralık ortalaması), mutlak $. Yetersiz veri → NaN. */
export function atr(bars: DailyBar[], n: number = QD.ATR_N): number {
  if (bars.length < n + 1) return NaN;
  return mean(trueRange(bars).slice(-n));
}

/** ATR / kapanış (yüzde olarak oran, ör. 0,03 = %3). */
export function atrPct(bars: DailyBar[], n: number = QD.ATR_N): number {
  const a = atr(bars, n), c = bars.length ? bars[bars.length - 1].c : NaN;
  return a / c;
}

/** n günlük göreli güç: hisse getirisi − SPY getirisi (aynı iki tarih arasında). SPY yoksa veya tarih eşleşmezse null. */
export function rs(bars: DailyBar[], spy: DailyBar[] | null | undefined, n: number): number | null {
  if (!spy || bars.length <= n) return null;
  const L = bars[bars.length - 1], B = bars[bars.length - 1 - n];
  const sL = spy.find(x => x.D === L.D), sB = spy.find(x => x.D === B.D);
  if (!sL || !sB) return null;
  return (L.c / B.c - 1) - (sL.c / sB.c - 1);
}

export interface Consol {
  days: number;               // sondan geriye ardışık "dar" gün sayısı (aralık < önceki 20 gün ort. aralığı; en çok 20)
  rangeContraction: number;   // son 5 gün ort. aralık / önceki 20 gün ort. aralık (NaN: yetersiz veri)
  higherLows: boolean;        // son 5 günün en düşük dibi, önceki 5 günün en düşük dibinden yüksek
  nearHigh: boolean;          // kapanış ≥ 0,9 × son 63 gün yükseği
  nearLow: boolean;           // kapanış ≤ 1,1 × son 63 gün düşüğü
}
export function consolidation(bars: DailyBar[]): Consol {
  const n = bars.length, rng = bars.map(b => b.h - b.l);
  const recent = rng.slice(-QD.CONSOL_RECENT);
  const base = rng.slice(Math.max(0, n - QD.CONSOL_RECENT - QD.CONSOL_BASE), Math.max(0, n - QD.CONSOL_RECENT));
  const baseAvg = mean(base);
  const rangeContraction = recent.length === QD.CONSOL_RECENT && base.length === QD.CONSOL_BASE && baseAvg > 0 ? mean(recent) / baseAvg : NaN;
  let days = 0;
  if (Number.isFinite(baseAvg)) {
    for (let i = n - 1; i >= 0 && days < QD.CONSOL_BASE; i--) { if (rng[i] < baseAvg) days++; else break; }
  }
  const lows = bars.map(b => b.l), highs = bars.map(b => b.h);
  const hl = n >= 10 && Math.min(...lows.slice(-5)) > Math.min(...lows.slice(-10, -5));
  const c = n ? bars[n - 1].c : NaN;
  const hi63 = Math.max(...highs.slice(-63)), lo63 = Math.min(...lows.slice(-63));
  return {
    days, rangeContraction, higherLows: hl,
    nearHigh: n > 0 && c >= QD.NEAR_FRAC * hi63,
    nearLow: n > 0 && c <= lo63 / QD.NEAR_FRAC,
  };
}

/** Son 21 ve 63 günlük getiri. */
export function priorMove(bars: DailyBar[]): { m21: number; m63: number } {
  const n = bars.length, c = n ? bars[n - 1].c : NaN;
  const r = (k: number) => n > k ? c / bars[n - 1 - k].c - 1 : NaN;
  return { m21: r(QD.RS_SHORT), m63: r(QD.RS_LONG) };
}

/** Uzama: (kapanış − EMA10) / ATR (mutlak) ve ardışık yükseliş / düşüş günü sayısı. */
export function extension(bars: DailyBar[]): { ext: number; upDays: number; downDays: number } {
  const n = bars.length;
  if (n < QD.EMA_FAST) return { ext: NaN, upDays: 0, downDays: 0 };
  const e10 = ema(bars.map(b => b.c), QD.EMA_FAST)[n - 1];
  const a = atr(bars);
  let upDays = 0, downDays = 0;
  for (let i = n - 1; i >= 1 && bars[i].c > bars[i - 1].c; i--) upDays++;
  for (let i = n - 1; i >= 1 && bars[i].c < bars[i - 1].c; i--) downDays++;
  return { ext: (bars[n - 1].c - e10) / a, upDays, downDays };
}

export interface QDaily {
  lastClose: number; lastD: string;
  ema10: number; ema20: number; ema20Slope: number;
  trendUp: boolean; trendDown: boolean;
  spy: boolean;                 // SPY serisi verildi mi (değilse RS bileşeni atlanır)
  rs21: number | null; rs63: number | null;
  atrPct: number; atrAbs: number;
  consol: Consol;
  m21: number; m63: number;
  ext: number; upDays: number; downDays: number;
  avgVol20: number; hi63: number; lo63: number;
  gapPct: number | null;        // bugünkü açılış verilirse: açılış / son kapanış − 1
  prevClose: number;
  qualityUp: number; qualityDown: number; quality: number;   // 0–100, bilgi amaçlı (skora katılmaz)
}

/** Yön bazlı Q-kalite (0–100): prior move + RS + daralma + yakınlık. Formül ve ağırlıklar QD'de. SPY yoksa RS puanı 0 (bilgi amaçlı). */
function qualityFor(up: boolean, p: { m21: number; m63: number; rs21: number | null; rs63: number | null; spy: boolean; contraction: number; near: boolean }): number {
  const sideOk = (x: number) => up ? x > 0 : x < 0;
  const move = sideOk(p.m63) ? clamp(Math.abs(p.m63) / QD.Q_MOVE_SCALE, 0, 1) * QD.W_MOVE : 0;
  const rsPts = p.spy && p.rs63 != null && sideOk(p.rs63) ? clamp(Math.abs(p.rs63) / QD.Q_RS_SCALE, 0, 1) * QD.W_RS : 0;
  const contract = Number.isFinite(p.contraction) && p.contraction <= QD.CONTRACTION_MAX ? clamp((1 - p.contraction) / 0.5, 0, 1) * QD.W_CONTRACT : 0;
  const near = p.near ? QD.W_NEAR : 0;
  const extra = sideOk(p.m63) && sideOk(p.m21) ? QD.W_EXTRA : 0;
  return Math.round(clamp(move + rsPts + contract + near + extra, 0, 100));
}

/** Günlük bağlam. Yetersiz geçmiş (< MIN_BARS) → null: Q setupları üretmez. */
export function qullDaily(bars: DailyBar[], spy: DailyBar[] | null | undefined, todayOpen?: number): QDaily | null {
  const n = bars.length;
  if (n < QD.MIN_BARS) return null;
  const closes = bars.map(b => b.c);
  const e10 = ema(closes, QD.EMA_FAST), e20 = ema(closes, QD.EMA_SLOW);
  const c = closes[n - 1], ema10 = e10[n - 1], ema20 = e20[n - 1], ema20Prev = e20[n - 1 - QD.SLOPE_DAYS];
  const slope = ema20 - ema20Prev;
  const trendUp = c > ema10 && ema10 > ema20 && slope > 0;
  const trendDown = c < ema10 && ema10 < ema20 && slope < 0;
  const rs21 = rs(bars, spy, QD.RS_SHORT), rs63 = rs(bars, spy, QD.RS_LONG);
  const consol = consolidation(bars), pm = priorMove(bars), ex = extension(bars);
  const hi63 = Math.max(...bars.slice(-63).map(b => b.h)), lo63 = Math.min(...bars.slice(-63).map(b => b.l));
  const avgVol20 = mean(bars.slice(-QD.AVG_VOL_N).map(b => b.v));
  const a = atr(bars);
  const base = { m21: pm.m21, m63: pm.m63, rs21, rs63, spy: !!spy, contraction: consol.rangeContraction };
  const qualityUp = qualityFor(true, { ...base, near: consol.nearHigh });
  const qualityDown = qualityFor(false, { ...base, near: consol.nearLow });
  return {
    lastClose: c, lastD: bars[n - 1].D, ema10, ema20, ema20Slope: slope,
    trendUp, trendDown, spy: !!spy, rs21, rs63,
    atrPct: a / c, atrAbs: a, consol, m21: pm.m21, m63: pm.m63,
    ext: ex.ext, upDays: ex.upDays, downDays: ex.downDays,
    avgVol20, hi63, lo63,
    gapPct: todayOpen != null && Number.isFinite(todayOpen) ? todayOpen / c - 1 : null,
    prevClose: c,
    qualityUp, qualityDown, quality: Math.max(qualityUp, qualityDown),
  };
}
