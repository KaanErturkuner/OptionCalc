/*
 * Tarihsel (EOD) opsiyon zincirinden rapor girdisi — saf, ağ YOK.
 * MarketData `options/chain?date=` (önceki kapanış) sunucuda çekilir (server/app/histfetch.ts); bu modül satırları
 * duvar anlık görüntüsüne ve birikim listesine çevirir. Birikim = açık pozisyon (OI, D−1 mutabakatı) × orta fiyat × 100:
 * "en büyük OI yoğunluğu". İşlem akışı (dV) DEĞİL; raporda bu ayrım etiketle belirtilir.
 */
import type { ChainRow } from '../flow/detect.ts';
import { flowExpiries } from '../flow/expiry.ts';
import { exDivMs } from '../usmarket.ts';
import { wallSnapFromRows } from './walls.ts';
import type { FlowAgg, WallSnap } from './types.ts';

/** Birikim: ticker başına en büyük N kontrat-grubu */
export const HIST_FLOW_PER_TICKER = 2;

/** Rapor gününün vade kümesi (akış sunucusuyla aynı): 0DTE + 3 ay içindeki Cuma vadeleri */
export function histExpiries(reportDay: string): string[] {
  return flowExpiries(exDivMs(reportDay)).map(t => t.date);
}

/** Orta fiyat: bid/ask varsa (bid+ask)/2; yoksa son işlem. Geçerli değilse null. */
export function midOf(r: Pick<ChainRow, 'bid' | 'ask' | 'last'>): number | null {
  if (r.bid > 0 && r.ask > 0) return (r.bid + r.ask) / 2;
  return r.last > 0 ? r.last : null;
}

/** Kaydedilen özet (tek ticker, tek zincir tarihi) */
export interface HistSnap {
  srcDay: string;            // zincir tarihi (kapanış verisi), ör. 2026-11-12
  reportDay: string;         // hangi rapor gününün vade kümesi
  asOf: number;              // zincirin zaman damgası (kapanış 16:00 ET, ms) — nokta-zamanlı kapı için
  expiries: string[];        // gerçekten satır getirilen vadeler
  rows: number;              // toplam kontrat satırı
  wall: WallSnap | null;
  flow: FlowAgg[];           // ticker başına en büyük OI birikimi (en çok HIST_FLOW_PER_TICKER)
}

/**
 * Zincir satırları (vade kümesine süzülmüş; tek ticker) → duvar + birikim.
 * wall: reportDay ve sonrasındaki en yakın vade (wallSnapFromRows ile aynı kural). flow: OI × mid × 100 ile sıralı.
 */
export function histSnapshot(rows: ChainRow[], reportDay: string, asOf: number): { wall: WallSnap | null; flow: FlowAgg[] } {
  const wall = wallSnapFromRows(rows, reportDay, asOf);
  const byTicker = new Map<string, FlowAgg[]>();
  for (const r of rows) {
    const mid = midOf(r);
    if (!(r.oi > 0) || mid == null) continue;
    const list = byTicker.get(r.ticker) ?? [];
    list.push({ ticker: r.ticker, expiry: r.expiry, side: r.side, strike: r.strike, contracts: r.oi, premium: r.oi * mid * 100 });
    byTicker.set(r.ticker, list);
  }
  const flow: FlowAgg[] = [];
  for (const list of byTicker.values()) flow.push(...list.sort((a, b) => b.premium - a.premium).slice(0, HIST_FLOW_PER_TICKER));
  return { wall, flow };
}
