/* Radar hisse detay grafiği: saf veri şekillendirme (strike satırları, pencere, kovalama, işaret değerleri). Ağ ve React yok. */
import type { Chain } from '../market/types.ts';
import { gex, maxPain, oiWalls } from '../odte/analytics.ts';
import { expirations } from '../usmarket.ts';

export interface StrikeRow { k: number; callOi: number; putOi: number; callVol: number; putVol: number }
export type Metric = 'oi' | 'vol';
export interface Markers { spot: number | null; callWall: number | null; putWall: number | null; flip: number | null; maxPain: number | null }

/** Calls ve puts'u strike'a göre birleştirir; artan sırada */
export function strikeRows(ch: Chain): StrikeRow[] {
  const m = new Map<number, StrikeRow>();
  const row = (k: number) => { let r = m.get(k); if (!r) { r = { k, callOi: 0, putOi: 0, callVol: 0, putVol: 0 }; m.set(k, r); } return r; };
  for (const o of ch.calls) { if (!(o.strike > 0)) continue; const r = row(o.strike); r.callOi += o.oi || 0; r.callVol += o.volume || 0; }
  for (const o of ch.puts) { if (!(o.strike > 0)) continue; const r = row(o.strike); r.putOi += o.oi || 0; r.putVol += o.volume || 0; }
  return [...m.values()].sort((a, b) => a.k - b.k);
}

/** En yakın vade (ET'de henüz kapanmamış ilk Cuma / aylık / 0DTE). Yalnız tarih döner: YYYY-MM-DD */
export function nearestExpiry(now: number): string | null {
  return expirations(now, 0.5)[0]?.date ?? null;
}

/**
 * Spot çevresi: |k/spot − 1| ≤ pct aralığındaki satırlar; çoksa spot'a en yakın maxBars tanesi. Sonuç artan sıralı.
 */
export function windowRows(rows: StrikeRow[], spot: number, pct = 0.15, maxBars = 60): StrikeRow[] {
  if (!(spot > 0)) return [];
  let w = rows.filter(r => Math.abs(r.k / spot - 1) <= pct);
  if (w.length > maxBars) w = [...w].sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot)).slice(0, maxBars).sort((a, b) => a.k - b.k);
  return w;
}

/** Çok strike varsa ardışık gruplar halinde kovalar (grup başına toplam OI/hacim; k = grubun ortalama strike'ı) */
export function bucketRows(rows: StrikeRow[], maxBars = 40): StrikeRow[] {
  if (rows.length <= maxBars) return rows;
  const size = Math.ceil(rows.length / maxBars), out: StrikeRow[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const g = rows.slice(i, i + size);
    out.push({
      k: g.reduce((a, r) => a + r.k, 0) / g.length,
      callOi: g.reduce((a, r) => a + r.callOi, 0), putOi: g.reduce((a, r) => a + r.putOi, 0),
      callVol: g.reduce((a, r) => a + r.callVol, 0), putVol: g.reduce((a, r) => a + r.putVol, 0),
    });
  }
  return out;
}

/** Grafikteki en büyük çubuk değeri (ölçek için); boşsa 0 */
export function metricMax(rows: StrikeRow[], metric: Metric): number {
  let m = 0;
  for (const r of rows) m = Math.max(m, metric === 'oi' ? r.callOi : r.callVol, metric === 'oi' ? r.putOi : r.putVol);
  return m;
}

/** Duvarlar, max pain, gamma flip — tüm zincir üzerinden (pencereden bağımsız). Yaklaşık: analytics.ts kuralları. */
export function markers(ch: Chain, spot: number | null, now: number): Markers {
  const w = oiWalls(ch);
  let flip: number | null = null;
  if (spot && spot > 0 && ch.calls.length + ch.puts.length > 0) flip = gex(ch, spot, now).flip;
  return { spot: spot && spot > 0 ? spot : null, callWall: w.callWall, putWall: w.putWall, flip, maxPain: maxPain(ch) };
}

/** Bir değer grafik alanında mı (kenar dışındakiler çizilmez, legend'da yine yazılır) */
export function inRange(v: number | null, rows: StrikeRow[]): boolean {
  return v != null && rows.length > 0 && v >= rows[0].k && v <= rows[rows.length - 1].k;
}

// ───── Dikey merdiven (ladder) geometrisi ─────
/** Satır yüksekliği ve üst/alt boşluk (px). Ekran ve testler aynı sabitleri kullanır. */
export const LADDER = { rowH: 22, top: 22, bottom: 8 } as const;

/** Strike satırları yukarıdan aşağıya: en yüksek strike en üstte. Girdiyi değiştirmez. */
export function ladderOrder(rows: StrikeRow[]): StrikeRow[] {
  return [...rows].sort((a, b) => b.k - a.k);
}

/**
 * Bir fiyatın satır indeksi (kesirli, 0 = en üst satır). Strike'lar arasında doğrusal enterpolasyon.
 * desc: ladderOrder çıktısı (azalan). Aralık dışındaysa null.
 */
export function valueIndex(v: number | null, desc: StrikeRow[]): number | null {
  if (v == null || !desc.length) return null;
  if (desc.length === 1) return v === desc[0].k ? 0 : null;
  if (v > desc[0].k || v < desc[desc.length - 1].k) return null;
  for (let i = 0; i < desc.length - 1; i++) {
    const hi = desc[i].k, lo = desc[i + 1].k;
    if (v <= hi && v >= lo) return hi === lo ? i : i + (hi - v) / (hi - lo);
  }
  return null;
}

/** Merdiven toplam yüksekliği (satır sayısına göre) */
export const ladderHeight = (n: number) => LADDER.top + n * LADDER.rowH + LADDER.bottom;

/** Kesirli satır indeksinin ekran y koordinatı (satır merkezi) */
export const rowY = (f: number) => LADDER.top + (f + 0.5) * LADDER.rowH;

/** Spot'a en yakın satırın indeksi (eşitlikte üstteki, yani daha yüksek strike). Boşsa −1. */
export function nearestIndex(desc: StrikeRow[], spot: number): number {
  let best = -1, bd = Infinity;
  desc.forEach((r, i) => { const d = Math.abs(r.k - spot); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** Açılışta / geçişte kaydırılacak ScrollView y değeri: spot satırı görünür alanın ortasına gelsin (kenarlarda kırpılır) */
export function scrollTargetY(desc: StrikeRow[], spot: number, viewH: number): number {
  const idx = nearestIndex(desc, spot);
  if (idx < 0) return 0;
  const contentH = ladderHeight(desc.length), maxY = Math.max(0, contentH - viewH);
  return Math.min(maxY, Math.max(0, rowY(idx) - viewH / 2));
}

/** Yatay işaret çizgileri: her biri için kesirli satır indeksi (aralık dışı / boşsa null) */
export function markerFracs(marks: Markers, desc: StrikeRow[]): { key: keyof Markers; f: number | null }[] {
  const keys: (keyof Markers)[] = ['spot', 'callWall', 'putWall', 'flip', 'maxPain'];
  return keys.map(key => ({ key, f: valueIndex(marks[key], desc) }));
}
