/*
 * Gün sonu (EOD) zincirinden akış olaylarını yeniden kurar. Saf, ağ YOK.
 * Canlı tarayıcı (poller) 2 dakikalık hacim farkına (dV) bakar. MarketData tarihsel opsiyon
 * kotasyonu/zinciri yalnız kapanış anını verir; gün içi opsiyon mumu dokümanda yoktur.
 * Bu yüzden dV = o günün toplam hacmi (açılış tabanı 0) kabul edilir — canlı taramanın
 * gün boyu birikimine denk, ancak tek olay olarak. Aynı eşikler (measure) kullanılır.
 * Zaman damgası kapanış 16:00 ET: gün içi an bilinmiyorsa uydurulmaz.
 * İsteğe bağlı: kümülatif hacim çubukları varsa 2 dk aralıklı dV (canlı tarayıcıya daha yakın).
 */
import { measure, type ChainRow } from './detect.ts';
import type { FlowEvent, FlowThresholds } from './model.ts';

export const RECONSTRUCTED_LABEL = 'Sonradan gerçek veriden oluşturuldu';

export type ReconstructedEvent = Omit<FlowEvent, 'id'>;

/** EOD zincir satırları → eşikleri geçen olaylar (kontrat başına en çok bir, kapanış anı). */
export function eodFlowEvents(rows: ChainRow[], day: string, closeTs: number, th: FlowThresholds): ReconstructedEvent[] {
  const out: ReconstructedEvent[] = [];
  for (const row of rows) {
    const dv = Math.max(0, row.volume);
    const m = measure(dv, row, th);
    if (!m) continue;
    out.push(fromMeasure(row, m, day, closeTs));
  }
  return out.sort((a, b) => b.prem - a.prem || a.occ.localeCompare(b.occ));
}

/** Çubuk hacmi (bar volume, artış). Kümülatife çevrilir. */
export interface IncBar { t: number; volume: number }
/** Kümülatif gün hacmi (zincir `volume` alanı gibi) + çubuk anı. */
export interface CumBar { t: number; volume: number }

export function cumulativeFromIncrements(bars: IncBar[]): CumBar[] {
  const out: CumBar[] = [];
  let sum = 0;
  for (const b of [...bars].sort((a, c) => a.t - c.t)) {
    const inc = Math.max(0, b.volume);
    sum += inc;
    out.push({ t: b.t, volume: sum });
  }
  return out;
}

/**
 * Kümülatif hacim serisinden 2 dk'lık dV olayları (canlı tarayıcıya benzer).
 * Fiyat (bid/ask/mid) çubukta yoksa EOD satırındaki kotasyon kullanılır — fiyat türetilmiştir.
 * cooldownMin: aynı kontratta art arda olay arası minimum süre (canlı soğuma ile aynı fikir).
 */
export function eventsFromCumulativeVolume(
  row: ChainRow, bars: CumBar[], day: string, th: FlowThresholds,
  opts: { intervalMin?: number; cooldownMin?: number } = {},
): ReconstructedEvent[] {
  const intervalMs = Math.max(1, opts.intervalMin ?? 2) * 60000;
  const cooldownMs = Math.max(0, opts.cooldownMin ?? 15) * 60000;
  const ordered = [...bars].filter(b => Number.isFinite(b.t) && Number.isFinite(b.volume)).sort((a, b) => a.t - b.t);
  if (!ordered.length) return [];
  const out: ReconstructedEvent[] = [];
  let prev = 0;
  let lastEventTs = -Infinity;
  let lastSampleT = ordered[0].t;
  for (const b of ordered) {
    // Örneklemeyi poll aralığına indir: aynı aralıktaki son çubuğu kullan
    if (b.t - lastSampleT < intervalMs && b !== ordered[ordered.length - 1]) continue;
    const dv = Math.max(0, b.volume - prev);
    prev = Math.max(prev, b.volume);
    lastSampleT = b.t;
    if (b.t - lastEventTs < cooldownMs) continue;
    const m = measure(dv, row, th);
    if (!m) continue;
    out.push(fromMeasure(row, m, day, b.t, { volume: b.volume }));
    lastEventTs = b.t;
  }
  return out;
}

function fromMeasure(row: ChainRow, m: NonNullable<ReturnType<typeof measure>>, day: string, ts: number, extra: { volume?: number } = {}): ReconstructedEvent {
  return {
    ts, day, ticker: row.ticker, occ: row.occ, expiry: row.expiry, side: row.side, strike: row.strike,
    dv: m.dv, volume: extra.volume ?? row.volume, oi: row.oi, bid: row.bid, ask: row.ask, mid: m.mid,
    prem: m.prem, volOi: m.volOi, confirmed: false, wide: m.wide, pushed: false,
    underlying: row.underlying, reconstructed: true,
  };
}
