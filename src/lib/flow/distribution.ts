/*
 * Akış dağılımı (Dağılım görünümü): olayları strike'a göre toplar, spot'u bulur. Saf: React / Date.now YOK.
 * Aynı strike'taki tüm vadeler birleşir (vade ayrımı yapılmaz).
 */
import type { FlowEvent } from './model.ts';

export interface DistRow {
  strike: number;
  callPrem: number; putPrem: number;   // USD
  callDv: number; putDv: number;       // kontrat
  net: number;                         // callPrem − putPrem
  total: number;                       // callPrem + putPrem
}

/** Olaylardan strike satırları (yüksek → düşük). Boş girdi → []. */
export function aggregateByStrike(events: FlowEvent[]): DistRow[] {
  const m = new Map<number, DistRow>();
  for (const e of events) {
    let r = m.get(e.strike);
    if (!r) { r = { strike: e.strike, callPrem: 0, putPrem: 0, callDv: 0, putDv: 0, net: 0, total: 0 }; m.set(e.strike, r); }
    if (e.side === 'call') { r.callPrem += e.prem; r.callDv += e.dv; }
    else { r.putPrem += e.prem; r.putDv += e.dv; }
  }
  return [...m.values()]
    .map(r => ({ ...r, net: r.callPrem - r.putPrem, total: r.callPrem + r.putPrem }))
    .sort((a, b) => b.strike - a.strike);
}

/** Spot: en son (max ts, eşitse max id) ve underlying'i dolu olayın underlying'i. Yoksa null. */
export function spotOf(events: Pick<FlowEvent, 'ts' | 'id' | 'underlying'>[]): number | null {
  let best: Pick<FlowEvent, 'ts' | 'id' | 'underlying'> | null = null;
  for (const e of events) {
    if (e.underlying == null || !(e.underlying > 0)) continue;
    if (!best || e.ts > best.ts || (e.ts === best.ts && e.id > best.id)) best = e;
  }
  return best ? best.underlying! : null;
}

/** Spot'a en yakın strike (eşitlikte yüksek olan). Satır yoksa veya spot yoksa null. */
export function atmStrike(rows: DistRow[], spot: number | null): number | null {
  if (spot == null || !rows.length) return null;
  let best = rows[0].strike;
  for (const r of rows) {
    const d = Math.abs(r.strike - spot), bd = Math.abs(best - spot);
    if (d < bd || (d === bd && r.strike > best)) best = r.strike;
  }
  return best;
}

/** Spot'a göre konum: üstünde / altında / seviyesinde (±%0,1 tolerans). Spot yoksa null. */
export function strikeSide(strike: number, spot: number | null): 'above' | 'below' | 'at' | null {
  if (spot == null) return null;
  if (strike > spot * 1.001) return 'above';
  if (strike < spot * 0.999) return 'below';
  return 'at';
}

/** |strike/spot − 1| ≤ pct ise spot civarında. Spot yoksa false. */
export function nearSpot(strike: number, spot: number | null, pct = 0.01): boolean {
  return spot != null && spot > 0 && Math.abs(strike / spot - 1) <= pct;
}

/** Olay kümesi özeti (yorum kuralları ve başlık için) */
export interface DistSummary {
  eventCount: number;
  callPrem: number; putPrem: number; totalPrem: number;
  zeroDtePrem: number;        // vade = olay günü
  reconstructedCount: number;
  spot: number | null;
}
export function distSummary(events: FlowEvent[]): DistSummary {
  let callPrem = 0, putPrem = 0, zeroDtePrem = 0, reconstructedCount = 0;
  for (const e of events) {
    if (e.side === 'call') callPrem += e.prem; else putPrem += e.prem;
    if (e.expiry === e.day) zeroDtePrem += e.prem;
    if (e.reconstructed) reconstructedCount++;
  }
  return { eventCount: events.length, callPrem, putPrem, totalPrem: callPrem + putPrem, zeroDtePrem, reconstructedCount, spot: spotOf(events) };
}
