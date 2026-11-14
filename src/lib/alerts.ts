/* Pozisyon uyarıları + bildirim metinleri (saf TS; bildirim gönderimi UI tarafında) */
import { closeMs, etDate, istHM } from './usmarket.ts';
import type { Trade } from './journal.ts';

export type AlertKind = 'nearTarget' | 'target' | 'nearStop' | 'stop';
export interface Live { opt?: number | null; und?: number | null }

/** Sinyalin çıkış anı (UTC ms): 0DTE → 15:30 ET, diğerleri → 15:45 ET (sinyal günü) */
export function exitAtMs(signalTime: number, dte: number): number {
  return closeMs(etDate(signalTime)) - (dte === 0 ? 30 : 15) * 60000;
}
const p2 = (x: number) => String(x).padStart(2, '0');
export function trHM(ms: number): string { return istHM(ms) + ' TR'; }
/** Bir an için verilen UTC ofsetinde (saat) "SS:DD" — telefon saatini göstermek için */
export function localHM(ms: number, offsetMin = -new Date(ms).getTimezoneOffset()): string {
  const d = new Date(ms + offsetMin * 60000);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/**
 * Hedef/stop kontrolü. Önce opsiyon fiyatı (prim hedef/stop), yoksa dayanak seviyeleri.
 * "Yaklaştı": girişten hedefe/stopa yolun ≥ near (varsayılan %75) kadarı alındı.
 * Daha önce gönderilenler (t.alerts) tekrar dönmez; hedef/stop gelince yaklaştı uyarısı atlanır.
 */
export function checkLevels(t: Trade, live: Live, near = 0.75): AlertKind[] {
  const sent = new Set(t.alerts || []);
  const out: AlertKind[] = [];
  const evalPair = (px: number, entry: number, tgt: number, stp: number, up: boolean) => {
    const prog = (lvl: number) => lvl === entry ? 0 : (px - entry) / (lvl - entry);
    const hitT = up ? px >= tgt : px <= tgt, hitS = up ? px <= stp : px >= stp;
    if (hitS) return 'stop' as const;
    if (hitT) return 'target' as const;
    if (prog(tgt) >= near) return 'nearTarget' as const;
    if (prog(stp) >= near) return 'nearStop' as const;
    return null;
  };
  let k: AlertKind | null = null;
  if (live.opt != null && isFinite(live.opt) && t.target != null && t.stop != null && t.target > t.entry && t.stop < t.entry) {
    k = evalPair(live.opt, t.entry, t.target, t.stop, true);
  } else if (live.und != null && isFinite(live.und) && t.undTarget != null && t.undStop != null && t.undRef != null) {
    const up = t.type === 'call';
    k = evalPair(live.und, t.undRef, t.undTarget, t.undStop, up);
  }
  if (!k) return out;
  if (k === 'target' || k === 'stop') { if (!sent.has(k)) out.push(k); }
  else if (!sent.has(k) && !sent.has(k === 'nearTarget' ? 'target' : 'stop')) out.push(k);
  return out;
}

const kLabel = (t: { ticker: string; type: string; strike?: number }) =>
  `${t.ticker} ${t.strike != null ? (t.strike % 1 ? t.strike.toFixed(1) : t.strike) : ''}${t.type === 'call' ? 'C' : t.type === 'put' ? 'P' : ''}`.trim();

export function alertText(t: Trade, k: AlertKind, live: Live): { title: string; body: string } {
  const px = live.opt != null ? `opsiyon $${live.opt.toFixed(2)}` : live.und != null ? `dayanak $${live.und.toFixed(2)}` : '';
  const L = kLabel(t);
  switch (k) {
    case 'target': return { title: `🎯 ${L} hedefe ulaştı — kârı al`, body: `${px} · hedef $${t.target?.toFixed(2) ?? '—'} · giriş $${t.entry.toFixed(2)}` };
    case 'stop': return { title: `🛑 ${L} stop seviyesinde — çık`, body: `${px} · stop $${t.stop?.toFixed(2) ?? '—'} · giriş $${t.entry.toFixed(2)}` };
    case 'nearTarget': return { title: `↗ ${L} hedefe yaklaştı`, body: `${px} · hedef $${t.target?.toFixed(2) ?? '—'}. Kâr almaya hazır ol.` };
    case 'nearStop': return { title: `↘ ${L} stopa yaklaştı`, body: `${px} · stop $${t.stop?.toFixed(2) ?? '—'}. Dikkat.` };
  }
}
export function exitText(t: Trade, minutesBefore = 0): { title: string; body: string } {
  const L = kLabel(t), at = t.exitAt ? trHM(t.exitAt) : '';
  return minutesBefore > 0
    ? { title: `⏰ ${L}: çıkışa ${minutesBefore} dk`, body: `Plan: en geç ${at} pozisyonu kapat.` }
    : { title: `⏰ ${L}: çıkış zamanı`, body: `${at} — planlanan çıkış. Pozisyonu kapat (0DTE vade sonuna bırakma).` };
}
/** Sinyal bildirimi tekrar anahtarı: sembol + yön + strike + vade + ET günü */
export const signalKey = (s: { ticker: string; dir: string; strike: number; expiry: string; time: number }) =>
  `${s.ticker}|${s.dir}|${s.strike}|${s.expiry}|${etDate(s.time)}`;

/** Günlük sinyal sınırı: aynı sembolde ET günü başına en fazla `max` farklı kontrat (yön+strike+vade).
 *  Zaten verilmiş bir kontrat tekrar gelirse izin verilir (aynı sinyal). */
export function signalAllowed(existing: { ticker: string; dir: string; strike: number; expiry: string; time: number }[],
  sg: { ticker: string; dir: string; strike: number; expiry: string; time: number }, max = 2): boolean {
  const day = etDate(sg.time), key = signalKey(sg);
  const keys = new Set(existing.filter(x => x.ticker === sg.ticker && etDate(x.time) === day).map(signalKey));
  return keys.has(key) || keys.size < max;
}
export const MAX_SIGNALS_PER_DAY = 2;
