/* Sinyal kaydı ve kalibrasyon özeti (skor kovası bazında). Saf. Kayıt en fazla 2.000. */
export type Decision = 'onaylandı' | 'reddedildi' | 'süresi doldu' | 'fiyat kaçtı' | 'veto';
export interface SignalLog {
  id: string; t: number; ticker: string; setup: string; dir: 'bull' | 'bear'; score: number; label: string;
  components: Record<string, number>; vetoes: string[]; source: string; dataAgeSec: number;
  result?: 'hedef' | 'stop' | 'zaman'; r?: number; mfeR?: number; maeR?: number; decision?: Decision;
}
export const LOG_KEEP = 2000;
export const bucketOf = (s: number) => s < 50 ? '0–49' : s < 65 ? '50–64' : s < 80 ? '65–79' : '80+';

export interface Bucket { bucket: string; n: number; winPct: number | null; avgR: number | null; expectancy: number | null; pf: number | null }
/** Kapanmış kayıtlar (result var) skor kovasına göre: n, kazanma %, ort. R, beklenti (= ort. R), PF */
export function calibration(rows: SignalLog[]): Bucket[] {
  const order = ['0–49', '50–64', '65–79', '80+'];
  return order.map(bk => {
    const xs = rows.filter(r => r.result && bucketOf(r.score) === bk && typeof r.r === 'number');
    const n = xs.length;
    if (!n) return { bucket: bk, n: 0, winPct: null, avgR: null, expectancy: null, pf: null };
    const wins = xs.filter(r => (r.r ?? 0) > 0).length;
    const gain = xs.filter(r => (r.r ?? 0) > 0).reduce((a, r) => a + (r.r ?? 0), 0);
    const loss = -xs.filter(r => (r.r ?? 0) < 0).reduce((a, r) => a + (r.r ?? 0), 0);
    const avgR = xs.reduce((a, r) => a + (r.r ?? 0), 0) / n;
    return { bucket: bk, n, winPct: wins / n * 100, avgR, expectancy: avgR, pf: loss > 0 ? gain / loss : null };
  });
}
export const appendLog = (rows: SignalLog[], r: SignalLog): SignalLog[] => [...rows, r].slice(-LOG_KEEP);
