/*
 * Bilanço takvimi (saf, uygulama + sunucu): gruplama, ay/hafta ızgarası, biçimlendirme, bildirim metni, zincir özeti.
 * Veri: sunucu GET /earnings (Finnhub) → src/lib/earnings/client.ts. Ayrıştırma ve yenileme politikası: model.ts.
 * Piyasa öncesi = bmo, piyasa sonrası = amc, diğer (dmh / boş) = saat belirtilmemiş.
 */
import { addDaysStr } from '../usmarket.ts';
import { timingOfHour, type EarnTiming, type EarningsItem } from './model.ts';

export type { EarnTiming } from './model.ts';

/** Piyasa öncesi / sonrası / saat belirtilmemiş gruplar; her grupta sembole göre sıralı */
export function groupByTiming(items: EarningsItem[]): Record<EarnTiming, EarningsItem[]> {
  const g: Record<EarnTiming, EarningsItem[]> = { pre: [], post: [], unknown: [] };
  for (const r of items) g[timingOfHour(r.hour)].push(r);
  for (const k of ['pre', 'post', 'unknown'] as EarnTiming[]) g[k].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return g;
}

/** Saat etiketi (kısa, Türkçe) */
export const timingOfHourLabel = (h: EarningsItem['hour']): string => (h === 'bmo' ? 'Piyasa öncesi (BMO)' : h === 'amc' ? 'Piyasa sonrası (AMC)' : 'Saat belirtilmedi');
export const TIMING_TITLE: Record<EarnTiming, string> = { pre: 'Piyasa öncesi', post: 'Piyasa sonrası', unknown: 'Saat belirtilmedi' };

/** Bir günde kaç şirket, hangi saatte (ızgara noktası ve sayaç için) */
export interface DayCount { total: number; pre: number; post: number }
export function countsByDay(items: EarningsItem[]): Map<string, DayCount> {
  const m = new Map<string, DayCount>();
  for (const it of items) {
    const c = m.get(it.date) ?? { total: 0, pre: 0, post: 0 };
    c.total++;
    const t = timingOfHour(it.hour);
    if (t === 'pre') c.pre++; else if (t === 'post') c.post++;
    m.set(it.date, c);
  }
  return m;
}

/** Ay ızgarası (pazartesi başlangıç). Her satır 7 hücre; ayın dışındaki hücreler null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;   // pazartesi = 0
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** Ayın ilk ve son günü (ISO). Sunucu aralığı en çok 31 gün; ay ızgarası bu aralıkla yüklenir. */
export function monthSpan(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Anchor gününü içeren pazartesi–pazar (ISO, 7 gün) */
export function weekOf(anchor: string): string[] {
  const dow = (new Date(anchor + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const mon = addDaysStr(anchor, -dow);
  return Array.from({ length: 7 }, (_, i) => addDaysStr(mon, i));
}

/** "$2,50" biçimi; null → "—" */
export function fmtEps(x: number | null): string {
  return x == null ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2).replace('.', ',')}`;
}

/** Gelir: tam dolar → "$12,3 mlr" / "$450 mln" / "$12,5 bin" (tr-TR ondalık). null → "—" */
export function fmtRevenue(x: number | null): string {
  if (x == null) return '—';
  const a = Math.abs(x), s = x < 0 ? '−' : '';
  const f = (v: number) => v.toFixed(1).replace('.', ',');
  if (a >= 1e9) return `${s}$${f(a / 1e9)} mlr`;
  if (a >= 1e6) return `${s}$${f(a / 1e6)} mln`;
  if (a >= 1e3) return `${s}$${f(a / 1e3)} bin`;
  return `${s}$${Math.round(a)}`;
}

/** Sürpriz %: "+4,2%" / "−3,1%"; null → null (gösterilmez) */
export function fmtSurprise(x: number | null): string | null {
  if (x == null) return null;
  const sign = x > 0 ? '+' : x < 0 ? '−' : '';
  return `${sign}${Math.abs(x).toFixed(1).replace('.', ',')}%`;
}

/** Piyasa değeri: "$2,4 mlr" / "$860 mln"; null → null */
export function fmtCap(x: number | null): string | null {
  return x == null ? null : fmtRevenue(x);
}

/** Sürpriz rengi: pozitif yeşil, negatif kırmızı, sıfır/yok nötr. */
export const surpriseTone = (x: number | null): 'pos' | 'neg' | 'muted' => (x == null || x === 0 ? 'muted' : x > 0 ? 'pos' : 'neg');

/** Gerçekleşen EPS bildirim metni (sunucu push'u ile aynı biçim). */
export function earnActualText(it: Pick<EarningsItem, 'symbol' | 'epsActual' | 'epsEstimate' | 'surprisePct'>): { title: string; body: string } {
  const sur = fmtSurprise(it.surprisePct);
  return {
    title: `Bilanço açıklandı · ${it.symbol}`,
    body: `EPS ${fmtEps(it.epsActual)} · beklenti ${fmtEps(it.epsEstimate)}${sur ? ` · sürpriz ${sur}` : ''}`,
  };
}
