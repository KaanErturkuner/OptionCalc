/*
 * Bilanço öncesi zımni hareket hipotezi (H1) için saf test motoru. Veri girdisi dışarıdan verilir; ağ ve dosya yok.
 *
 * Hipotez: bilanço öncesi ATM straddle'ın fiyatladığı hareket (zımni, oran), ertesi gün gerçekleşen mutlak hareketi
 * sistematik olarak aşıyor. Kısa straddle (primi sat, ertesi kapanışta kapat) maliyet sonrası pozitif beklenti üretiyor mu?
 *
 * Girdi her olay için (oran, spot'a göre):
 *   impliedPct  : bilanço öncesi ATM straddle primi / spot (zımni hareket)
 *   realizedPct : ertesi gün |getiri| / spot (gerçekleşen mutlak hareket)
 *   costPct     : işlem maliyeti (spread × 1,5 + kayma) / spot
 *
 * Yaklaşıklık: kısa straddle P/L = implied − realized − cost. Gerçek opsiyon P/L'si vega, gamma ve teta içerir;
 * bu bir ilk eleme ölçüsüdür, karar ölçüsü değildir. Kabul kriterleri docs/kurullar/oneriler.md (H1) ile aynıdır.
 */

export interface EarnEvent { symbol: string; date: string; impliedPct: number; realizedPct: number; costPct: number }

export interface EarnTestOpts { minEvents?: number; oosFrac?: number; topRemove?: number }
export interface EarnTestResult {
  n: number;
  medianRatio: number | null;          // medyan |hareket| / zımni hareket (1'in üstü: zımni az fiyatlamış)
  shareRealizedBelowImplied: number | null; // zımni hareketin altında kalan olay payı (kısa straddle için iyi)
  meanPnl: number | null;              // olay başına ortalama net P/L (spot oranı)
  ci95: [number, number] | null;       // ortalama için %95 normal yaklaşık güven aralığı
  oos: { n: number; meanPnl: number | null };
  topRemoved: { k: number; meanPnl: number | null };   // en büyük k gerçekleşen hareket çıkarılınca ortalama
  pass: boolean;
  reasons: string[];                   // geçmeyen kriterler (Türkçe)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** Olayları tarihe göre sıralar; ilk (1 − oosFrac) kısım iç örneklem, son oosFrac dış örneklem. */
export function evaluateEarningsEvents(events: EarnEvent[], opts: EarnTestOpts = {}): EarnTestResult {
  const minEvents = opts.minEvents ?? 60, oosFrac = opts.oosFrac ?? 0.5, topRemove = opts.topRemove ?? 5;
  const sorted = [...events].filter(e => Number.isFinite(e.impliedPct) && e.impliedPct > 0 && Number.isFinite(e.realizedPct)
    && Number.isFinite(e.costPct)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const pnl = (e: EarnEvent) => e.impliedPct - e.realizedPct - e.costPct;
  const pnls = sorted.map(pnl);
  const n = sorted.length;
  const m = mean(pnls), s = sd(pnls);
  const ci95: [number, number] | null = n >= 2 && s != null && m != null ? [m - 1.96 * s / Math.sqrt(n), m + 1.96 * s / Math.sqrt(n)] : null;

  const cut = Math.floor(n * (1 - oosFrac));
  const oosP = sorted.slice(cut).map(pnl);

  const bigRealized = [...sorted].sort((a, b) => b.realizedPct - a.realizedPct).slice(0, topRemove);
  const dropSet = new Set(bigRealized);
  const rest = sorted.filter(e => !dropSet.has(e)).map(pnl);

  const ratios = sorted.map(e => e.realizedPct / e.impliedPct);
  const below = sorted.filter(e => e.realizedPct < e.impliedPct).length;

  const reasons: string[] = [];
  if (n < minEvents) reasons.push(`olay sayısı ${n} < ${minEvents}`);
  if (m == null || m <= 0) reasons.push('maliyet sonrası ortalama P/L ≤ 0');
  if (ci95 && ci95[0] < 0) reasons.push('%95 alt sınır < 0');
  if (oosP.length === 0 || (mean(oosP) ?? -1) <= 0) reasons.push('dış örneklemde ortalama P/L ≤ 0');
  if (rest.length === 0 || (mean(rest) ?? -1) <= 0) reasons.push(`en büyük ${topRemove} hareket çıkarılınca ortalama ≤ 0`);

  return {
    n,
    medianRatio: median(ratios),
    shareRealizedBelowImplied: n ? below / n : null,
    meanPnl: m,
    ci95,
    oos: { n: oosP.length, meanPnl: mean(oosP) },
    topRemoved: { k: topRemove, meanPnl: mean(rest) },
    pass: reasons.length === 0,
    reasons,
  };
}
