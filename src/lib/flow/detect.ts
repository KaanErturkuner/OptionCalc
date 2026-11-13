/*
 * Olağandışı akış tespiti (FLOW.md §5) — saf mantık.
 * Hacim farkı (dV = volume_t − volume_{t−1}) kontrat başına; prim = dV × mid × 100.
 * Önce önbellekli zincir (aday seçimi), sonra canlı kotasyonla teyit (confirmEvent).
 */
import type { FlowThresholds } from './model.ts';

/** Zincir satırı (MarketData chain'den sunucuda çıkarılmış) */
export interface ChainRow {
  occ: string; ticker: string; expiry: string; side: 'call' | 'put'; strike: number;
  volume: number; oi: number; bid: number; ask: number; last: number;
  updated: number;          // kotasyon anı (ms); değişmediyse dV = 0
  underlying: number | null;
}
/** Kontrat başına son görülen hacim + güncelleme anı (gün içi taban) */
export interface Baseline { vol: number; upd: number }

/** Mid: bid/ask geçerliyse ortası, değilse son işlem (types.ts mid() ile aynı kural) */
export function midOf(bid: number, ask: number, last: number): number {
  if (bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  if (last > 0) return last;
  return ask > 0 ? ask / 2 : 0;
}

export interface Measure { dv: number; mid: number; prem: number; volOi: number; wide: boolean }

/** Eşikleri geçiyorsa ölçüm, geçmiyorsa null (gürültü: mid, hacim, OI oranı, prim) */
export function measure(dv: number, row: Pick<ChainRow, 'bid' | 'ask' | 'last' | 'oi'>, th: FlowThresholds): Measure | null {
  if (!(dv > 0) || dv < th.minVolume) return null;
  const mid = midOf(row.bid, row.ask, row.last);
  if (mid < th.minMid) return null;
  if (row.oi > 0 && dv < th.minVolOi * row.oi) return null;
  const prem = dv * mid * 100;
  if (prem < th.minPremium) return null;
  const spread = row.bid > 0 && row.ask > 0 ? (row.ask - row.bid) / mid : Infinity;
  return { dv, mid, prem, volOi: row.oi > 0 ? dv / row.oi : 0, wide: spread > th.maxSpreadPct };
}

export interface Candidate { row: ChainRow; prev: number; m: Measure }

/**
 * Önbellekli taramada aday kontratlar (prim sırasıyla).
 * first = günün ilk taraması: referans yok, aday çıkmaz (FLOW §5.1). Baseline'da olmayan kontrat: önceki hacim 0.
 * inCooldown: son uyarıdan bu yana süre dolmamış kontrat atlanır.
 */
export function candidates(rows: ChainRow[], base: Map<string, Baseline>, th: FlowThresholds, first: boolean, inCooldown: (occ: string) => boolean): Candidate[] {
  if (first) return [];
  const out: Candidate[] = [];
  for (const row of rows) {
    const b = base.get(row.occ);
    if (b && b.upd === row.updated) continue;       // kotasyon değişmedi → yeni bilgi yok
    const prev = b?.vol ?? 0;
    const dv = Math.max(0, row.volume - prev);       // negatif fark → 0 (veri düzeltmesi)
    const m = measure(dv, row, th);
    if (!m || inCooldown(row.occ)) continue;
    out.push({ row, prev, m });
  }
  return out.sort((a, b) => b.m.prem - a.m.prem);
}

/** Tarama sonrası baseline güncellemesi: değişen her kontrat için yeni hacim + anı */
export function nextBaseline(rows: ChainRow[], base: Map<string, Baseline>): Map<string, Baseline> {
  const next = new Map(base);
  for (const r of rows) {
    const b = base.get(r.occ);
    if (!b || b.upd !== r.updated) next.set(r.occ, { vol: r.volume, upd: r.updated });
  }
  return next;
}

/**
 * Canlı teyit: aynı kontratın canlı kotasyonu (options/quotes). Önceki hacme göre yeniden ölçülür.
 * Dönen: teyitli ölçüm (eşikleri geçti) ya da null. Baseline her durumda canlı hacme güncellenmeli (çağıran yapar).
 */
export function confirmLive(prev: number, live: ChainRow, th: FlowThresholds): Measure | null {
  const dv = Math.max(0, live.volume - prev);
  return measure(dv, live, th);
}
