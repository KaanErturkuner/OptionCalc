/*
 * Dayanak mumları (saf): Yahoo chart OHLCV ayrıştırma, VWAP, pencere, çıkış sonrası hareket ve hacim patlaması.
 * Yön: CALL için yukarı = lehe; PUT için aşağı = lehe. Tüm yüzdeler dayanak fiyatına göre (%).
 */
import { etDate } from '../usmarket.ts';
import { etMinutesOf } from './time.ts';
import type { OptSide } from './types.ts';

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

/** Yahoo v8 chart → 1 dk / 5 dk barlar (eksik değerli barlar atlanır). Hatalı → []. */
export function parseYahooBars(j: any): Bar[] {
  const r = j?.chart?.result?.[0];
  const ts: unknown[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  if (!q || !Array.isArray(ts)) return [];
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i], o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if (typeof t !== 'number' || [o, h, l, c].some(x => typeof x !== 'number' || !Number.isFinite(x))) continue;
    out.push({ t: t * 1000, o, h, l, c, v: typeof v === 'number' && Number.isFinite(v) ? v : 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** ET işlem günündeki seans barları (09:30–16:00 ET) */
export function sessionBars(bars: Bar[], day: string): Bar[] {
  return bars.filter(b => etDate(b.t) === day && etMinutesOf(b.t) >= 570 && etMinutesOf(b.t) < 960);
}

/** Seans VWAP'ı: t ≤ untilMs olan seans barları (tipik fiyat × hacim). Hacim yoksa null. */
export function vwapAt(session: Bar[], untilMs: number): number | null {
  let pv = 0, v = 0;
  for (const b of session) {
    if (b.t > untilMs) break;
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v; v += b.v;
  }
  return v > 0 ? +(pv / v).toFixed(2) : null;
}

/** t anındaki (veya hemen öncesindeki) bar; bar yoksa null */
export function barAt(bars: Bar[], t: number, maxAgeMs = 120000): Bar | null {
  let found: Bar | null = null;
  for (const b of bars) { if (b.t <= t) found = b; else break; }
  return found && t - found.t <= maxAgeMs ? found : null;
}

/** [fromMs, toMs] aralığındaki 1 dk barları N dk'lık mumlara toplar (en fazla ~ (aralık/N) mum) */
export function aggregate(bars: Bar[], fromMs: number, toMs: number, stepMin = 5): Bar[] {
  const step = stepMin * 60000;
  const sel = bars.filter(b => b.t >= fromMs && b.t <= toMs);
  const out = new Map<number, Bar>();
  for (const b of sel) {
    const k = Math.floor(b.t / step) * step;
    const cur = out.get(k);
    if (!cur) out.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/** Çıkıştan sonra dayanağın hareketi: en lehe/aleyhe uç ve 15/30/60 dk sonraki yüzde (kararlı, yüzde) */
export interface AfterExit {
  horizonMin: number;
  bestFavPct: number;      // lehe en büyük hareket (%)
  worstAgainstPct: number; // aleyhe en büyük hareket (%, negatif olabilir)
  at15: number | null; at30: number | null; at60: number | null; // lehe yönde pozitif
  minutesToBestFav: number | null;
}

export function afterExitMove(bars: Bar[], exitMs: number, exitUnderlying: number, side: OptSide, horizonMin = 60): AfterExit | null {
  if (!(exitUnderlying > 0)) return null;
  const sign = side === 'CALL' ? 1 : -1;
  const end = exitMs + horizonMin * 60000;
  const sel = bars.filter(b => b.t > exitMs && b.t <= end);
  if (!sel.length) return null;
  let bestFav = 0, worst = 0, bestAt: number | null = null;
  const pctAt = (min: number): number | null => {
    const b = barAt(sel, exitMs + min * 60000, 180000);
    return b ? +(sign * (b.c / exitUnderlying - 1) * 100).toFixed(3) : null;
  };
  for (const b of sel) {
    if (sign > 0) {
      if (b.h > exitUnderlying && (b.h / exitUnderlying - 1) * 100 > bestFav) { bestFav = (b.h / exitUnderlying - 1) * 100; bestAt = b.t; }
      if (b.l < exitUnderlying && (b.l / exitUnderlying - 1) * 100 < worst) worst = (b.l / exitUnderlying - 1) * 100;
    } else {
      if (b.l < exitUnderlying && (1 - b.l / exitUnderlying) * 100 > bestFav) { bestFav = (1 - b.l / exitUnderlying) * 100; bestAt = b.t; }
      if (b.h > exitUnderlying && (1 - b.h / exitUnderlying) * 100 < worst) worst = (1 - b.h / exitUnderlying) * 100;
    }
  }
  return {
    horizonMin,
    bestFavPct: +bestFav.toFixed(3), worstAgainstPct: +worst.toFixed(3),
    at15: pctAt(15), at30: pctAt(30), at60: pctAt(60),
    minutesToBestFav: bestAt == null ? null : Math.round((bestAt - exitMs) / 60000),
  };
}

/** Çıkıştan sonraki pencerede en büyük hacimli bar (ortancaya göre oran) ve yönü */
export function volumeSpikeAfter(bars: Bar[], exitMs: number, horizonMin = 30): { atMin: number; ratio: number; dir: 'yukari' | 'asagi' } | null {
  const idx = bars.findIndex(b => b.t > exitMs);
  if (idx < 0) return null;
  const base = bars.slice(Math.max(0, idx - 20), idx).map(b => b.v).filter(v => v > 0).sort((a, b) => a - b);
  if (base.length < 5) return null;
  const med = base[Math.floor(base.length / 2)];
  let best: Bar | null = null;
  for (const b of bars.slice(idx)) {
    if (b.t > exitMs + horizonMin * 60000) break;
    if (!best || b.v > best.v) best = b;
  }
  if (!best || med <= 0) return null;
  return { atMin: Math.round((best.t - exitMs) / 60000), ratio: +(best.v / med).toFixed(2), dir: best.c >= best.o ? 'yukari' : 'asagi' };
}

/** Bir ET günündeki açılış fiyatı (ilk seans barının açılışı) */
export const openOf = (session: Bar[]): number | null => (session.length ? session[0].o : null);
