/*
 * Korku ve Açgözlülük (kendi bileşik endeksimiz). CNN'in endeksi DEĞİLDİR: CNN'in veri uç noktası belgelenmemiş ve kullanım
 * koşulları belirsiz olduğu için, uygulamanın zaten kullandığı anahtarsız günlük verilerle (Yahoo) benzer bileşenler hesaplanır.
 * Saf fonksiyonlar: ağ yok. Her bileşen 0–100 (100 = açgözlülük), kendi 6 aylık penceresine göre yüzdelik sıralama.
 * Bileşenler: VIX (ters), SPY momentumu (50 gün ortalamaya göre sapma), güvenli liman (SPY − TLT 20 gün getirisi),
 * yüksek getirili tahvil talebi (HYG/LQD oranı). Put/call bileşeni geçmiş gerektirdiği için henüz eklenmedi.
 */

export interface Px { D: string; c: number }

/** Değerin pencere içindeki yüzdelik sırası (0–100): pencerede kendisinden küçük değerlerin oranı */
export function percentileOf(value: number, window: number[]): number | null {
  const xs = window.filter(x => Number.isFinite(x));
  if (!Number.isFinite(value) || xs.length < 20) return null;
  return (xs.filter(x => x < value).length / xs.length) * 100;
}

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/** Seriler son değere kadar: her gün için, o günden geriye bakan özellik (ör. 50 günlük ortalamaya sapma) */
export function rollingFeature(closes: number[], lookback: number, f: (window: number[]) => number): number[] {
  const out: number[] = [];
  for (let i = lookback - 1; i < closes.length; i++) out.push(f(closes.slice(i - lookback + 1, i + 1)));
  return out;
}

/** SPY momentumu: son kapanışın 50 günlük ortalamaya göre sapması */
export const momentumDev = (closes: number[]) => {
  const feat = rollingFeature(closes, 50, w => w[w.length - 1] / (w.reduce((a, b) => a + b, 0) / w.length) - 1);
  return feat;
};

/** Son değer ve pencere: pencerenin son değerinin tarihsel sırası */
export function componentFromSeries(series: number[], invert = false): number | null {
  if (series.length < 21) return null;
  const last = series[series.length - 1];
  const p = percentileOf(last, series.slice(0, -1));
  if (p == null) return null;
  return clamp(invert ? 100 - p : p);
}

/** 20 günlük getiri farkı: SPY − TLT (pozitif = hisse tahvilden iyi → açgözlülük) */
export function safeHavenSeries(spy: number[], tlt: number[]): number[] {
  const n = Math.min(spy.length, tlt.length);
  const s = spy.slice(spy.length - n), t = tlt.slice(tlt.length - n);
  const out: number[] = [];
  for (let i = 20; i < n; i++) out.push((s[i] / s[i - 20] - 1) - (t[i] / t[i - 20] - 1));
  return out;
}

/** HYG/LQD oranı (yüksek → yüksek getirili tahvil talebi güçlü → açgözlülük) */
export function junkSeries(hyg: number[], lqd: number[]): number[] {
  const n = Math.min(hyg.length, lqd.length);
  const h = hyg.slice(hyg.length - n), l = lqd.slice(lqd.length - n);
  return h.map((x, i) => x / l[i]);
}

export type Rating = 'Aşırı korku' | 'Korku' | 'Nötr' | 'Açgözlülük' | 'Aşırı açgözlülük';
export const rating = (score: number): Rating =>
  score < 25 ? 'Aşırı korku' : score < 45 ? 'Korku' : score <= 55 ? 'Nötr' : score <= 75 ? 'Açgözlülük' : 'Aşırı açgözlülük';

export interface FngComponent { key: 'vix' | 'momentum' | 'safeHaven' | 'junk'; label: string; score: number | null }
export interface FngResult { score: number | null; rating: Rating | null; components: FngComponent[]; used: number; note: string }

/** Bileşenlerden bileşik puan: mevcut bileşenlerin eşit ağırlıklı ortalaması (en az 2 bileşen gerekir). */
export function composite(components: FngComponent[]): FngResult {
  const ok = components.filter(c => c.score != null) as (FngComponent & { score: number })[];
  if (ok.length < 2) return { score: null, rating: null, components, used: ok.length, note: 'Yetersiz veri (en az 2 bileşen gerekir).' };
  const score = ok.reduce((a, c) => a + c.score, 0) / ok.length;
  return { score: Math.round(score), rating: rating(score), components, used: ok.length,
    note: 'Kendi bileşik endeksimiz (CNN ile aynı değil). Put/call bileşeni henüz yok. Bilgi amaçlıdır; yatırım tavsiyesi değildir.' };
}

/** Ham günlük seriler → bileşenler (ağ çağrısı yok). Girdi kronolojik kapanışlar. */
export function buildComponents(d: { vix: number[]; spy: number[]; tlt: number[]; hyg: number[]; lqd: number[] }): FngComponent[] {
  return [
    { key: 'vix', label: 'VIX (ters)', score: componentFromSeries(d.vix, true) },
    { key: 'momentum', label: 'SPY momentumu', score: componentFromSeries(momentumDev(d.spy)) },
    { key: 'safeHaven', label: 'Güvenli liman (SPY − TLT)', score: componentFromSeries(safeHavenSeries(d.spy, d.tlt)) },
    { key: 'junk', label: 'Yüksek getirili tahvil talebi', score: componentFromSeries(junkSeries(d.hyg, d.lqd)) },
  ];
}
