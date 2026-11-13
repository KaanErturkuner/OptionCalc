/*
 * Rejim/sektör stratejileri için diğer sembollerin 1 dk barları (QQQ, SPY, SMH…), fetch.mts ile AYNI aylık mum yollarından (aynı önbellek).
 *   Yükleme (çevrimdışı, kredi yok): loadPeers(['QQQ','SPY','SMH'])
 *   Eksik sembolü indirme (token gerekir, ~9 kredi/ay):  MARKETDATA_TOKEN=... node backtest/peers.mts SMH [SOXX]
 */
import fs from 'node:fs';
import { etDate, closeMs } from '../src/lib/usmarket.ts';
import { START, END } from './common.mts';
import type { Bar } from '../src/lib/odte/analytics.ts';

export function months(start = START, end = END): [string, string][] {
  const out: [string, string][] = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7);) { const a = m + '-01'; const n = new Date(Date.parse(a) + 32 * 864e5).toISOString().slice(0, 7); out.push([a, n + '-01']); m = n; }
  return out;
}
async function barsFor(sym: string, start: string, end: string): Promise<Map<string, Bar[]>> {
  const { get } = await import('./md.mts'), byD = new Map<string, Bar[]>();
  for (const [a, b] of months(start, end)) {
    const j = await get(`/stocks/candles/1/${sym}/?from=${a}&to=${b}`);
    if (!Array.isArray(j?.t)) continue;
    for (let i = 0; i < j.t.length; i++) {
      const t = j.t[i] * 1000, D = etDate(t), c = closeMs(D); if (t < c - 6.5 * 3600000 || t >= c) continue;
      if (!byD.has(D)) byD.set(D, []);
      byD.get(D)!.push({ t, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v?.[i] ?? 0 });
    }
  }
  for (const v of byD.values()) v.sort((x, y) => x.t - y.t);
  return byD;
}
/** ^VIX için 1 dk yok (MarketData planında yok). Çevrimdışıyken Yahoo günlük kapanışları kullanılır (aux/VIX-yahoo-daily.json). */
export const VIX_DAILY_FILE = process.env.BT_VIX_FILE || '/workspace/backtest/aux/VIX-yahoo-daily.json';
export function loadVixDaily(file = VIX_DAILY_FILE): Map<string, number> {
  const out = new Map<string, number>();
  if (!fs.existsSync(file)) return out;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of j.rows ?? []) if (Number.isFinite(r.c)) out.set(r.D, r.c);
  return out;
}
/** Önbellekten yükle (istek atmaz). Dönen fonksiyon motorun RunOpts.peers'ına verilir.
 *  ^VIX: 1 dk barı yok → get() null döner; günlük kapanış için vix(D) kullanılır (yalnız çevrimdışı dosyadan). */
export async function loadPeers(symbols: string[], start = START, end = END) {
  const prev = process.env.BT_OFFLINE; process.env.BT_OFFLINE = '1';
  const m = new Map<string, Map<string, Bar[]>>();
  const vixDaily = symbols.includes('^VIX') ? loadVixDaily() : new Map<string, number>();
  try { for (const s of symbols) if (s !== '^VIX') m.set(s, await barsFor(s, start, end)); } finally { if (prev == null) delete process.env.BT_OFFLINE; else process.env.BT_OFFLINE = prev; }
  const cover: Record<string, number> = Object.fromEntries([...m].map(([s, v]) => [s, v.size]));
  if (symbols.includes('^VIX')) cover['^VIX(günlük)'] = [...vixDaily.keys()].filter(d => d >= start && d <= end).length;
  return { get: (sym: string, D: string) => m.get(sym)?.get(D) ?? null, vix: (D: string) => vixDaily.get(D) ?? null, cover };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { close, summary } = await import('./md.mts');
  for (const s of process.argv.slice(2)) { const b = await barsFor(s.toUpperCase(), START, END); console.log(s, 'gün', b.size); }
  console.log(summary()); close();
}
