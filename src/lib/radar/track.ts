/* İsabet takibi (Aşama E): uyarı sonrası fiyat ölçümü, yön isabeti, dedektör bazında özet. Saf fonksiyonlar. */
import type { Bar } from '../odte/analytics.ts';
import { closeMs, etDate } from '../usmarket.ts';
import type { Direction, SignalKind } from './types.ts';

export const H30 = 30 * 60000, H2 = 120 * 60000;
/** t anına en yakın bar kapanışı (tolMs içinde); yoksa null */
export function priceAt(bars: Bar[], t: number, tolMs = 5 * 60000): number | null {
  let best: Bar | null = null;
  for (const b of bars) if (b.t <= t && (!best || b.t > best.t)) best = b;
  return best && t - best.t <= tolMs ? best.c : null;
}
/** Ertesi işlem günü: sonraki seansın ilk barının açılışı (yaklaşık) */
export function nextSessionOpen(bars: Bar[], alertAt: number): number | null {
  const day = etDate(alertAt), nxt = bars.filter(b => etDate(b.t) > day).sort((a, b) => a.t - b.t);
  return nxt[0]?.o ?? null;
}
export const eodOf = (alertAt: number) => closeMs(etDate(alertAt));
/** Yön isabeti (2 saatlik ufuk). neutral → ölçülmez (null). vol → |hareket| ≥ 0,5 × beklenen hareket (%). */
export function hitOf(direction: Direction, spot: number, price: number, emPct: number | null): boolean | null {
  const move = price / spot - 1;
  if (direction === 'bull') return move > 0;
  if (direction === 'bear') return move < 0;
  if (direction === 'vol') return emPct != null && emPct > 0 ? Math.abs(move) >= 0.5 * emPct : null;
  return null;
}
export interface Scored { kinds: SignalKind[]; direction: Direction; spot: number; emPct: number | null; outcome: { h2?: number | null } }
/** Dedektör türüne göre özet: ölçülen sayı, yön isabet oranı, ortalama yönlü hareket (%) ve beklenen hareket katı */
export function summarize(rows: Scored[]): { kind: SignalKind; n: number; hitPct: number | null; avgMovePct: number | null; avgEm: number | null }[] {
  const byKind = new Map<SignalKind, { hits: number; n: number; mv: number; em: number; emN: number }>();
  for (const r of rows) {
    const p = r.outcome.h2; if (p == null || !r.kinds.length) continue;
    const k = r.kinds[0], hit = hitOf(r.direction, r.spot, p, r.emPct);
    const e = byKind.get(k) ?? { hits: 0, n: 0, mv: 0, em: 0, emN: 0 };
    const move = (p / r.spot - 1) * (r.direction === 'bear' ? -1 : 1);
    e.n++; if (hit) e.hits++; e.mv += move;
    if (r.emPct && r.emPct > 0) { e.em += move / r.emPct; e.emN++; }
    byKind.set(k, e);
  }
  return [...byKind].map(([kind, e]) => ({ kind, n: e.n, hitPct: e.n ? Math.round(e.hits / e.n * 100) : null,
    avgMovePct: e.n ? +(e.mv / e.n * 100).toFixed(2) : null, avgEm: e.emN ? +(e.em / e.emN).toFixed(2) : null }));
}

export type BarrierResult = 'win' | 'loss' | 'timeout';
/** Bariyer isabeti: uyarıdan sonra horizonMs içinde yönlü +k·EM hedefi mi önce vuruldu, yoksa −k·EM stopu mu (bar high/low yolu).
 *  Aynı barda ikisi de vurulursa muhafazakâr davranıp kayıp sayılır. Veri ufku kapsamıyorsa null (ölçülmez). */
export function barrierOf(direction: Direction, spot: number, bars: Bar[], at: number, emPct: number | null, horizonMs = H2, k = 0.5): BarrierResult | null {
  if ((direction !== 'bull' && direction !== 'bear') || !emPct || emPct <= 0) return null;
  const up = direction === 'bull' ? spot * (1 + k * emPct) : spot * (1 - k * emPct);
  const dn = direction === 'bull' ? spot * (1 - k * emPct) : spot * (1 + k * emPct);
  const path = bars.filter(b => b.t > at && b.t <= at + horizonMs).sort((a, b) => a.t - b.t);
  if (!bars.some(b => b.t >= at + horizonMs - 5 * 60000)) return null;
  for (const b of path) {
    const hitWin = direction === 'bull' ? b.h >= up : b.l <= up;
    const hitLoss = direction === 'bull' ? b.l <= dn : b.h >= dn;
    if (hitWin && hitLoss) return 'loss';
    if (hitLoss) return 'loss';
    if (hitWin) return 'win';
  }
  return 'timeout';
}
/** Bariyer özeti: win / (win + loss) — timeout ayrı sayılır (yön bilgisi yok) */
export function barrierSummary(rs: (BarrierResult | null | undefined)[]): { n: number; winPct: number | null; timeoutPct: number | null } {
  const v = rs.filter((x): x is BarrierResult => x != null), w = v.filter(x => x === 'win').length, l = v.filter(x => x === 'loss').length, t = v.length - w - l;
  return { n: v.length, winPct: w + l ? Math.round(w / (w + l) * 100) : null, timeoutPct: v.length ? Math.round(t / v.length * 100) : null };
}
