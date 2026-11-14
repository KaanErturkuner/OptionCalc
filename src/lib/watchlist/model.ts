/* Takip listesi: saf model (React, depolama ve ağ yok). Opsiyon kalemi, OCC sembolü, vade durumu, İstanbul saati. */
import { closeMs, DAY_MS } from '../usmarket.ts';

export type OptType = 'call' | 'put';
/** Giriş primi kaynağı: zincirden mid · kullanıcının girdiği prim · hesap (teorik) */
export type EntrySrc = 'zincir' | 'girilen' | 'teorik';

/** Son bilinen fiyat (yenilemede güncellenir; vade dolunca bu değer korunur) */
export interface Snapshot { premium: number | null; underlying: number | null; at: number; provider?: string }

export interface WatchItem {
  id: string; symbol: string; expiry: string; strike: number; type: OptType;
  side: 1 | -1;             // 1 = long, −1 = short
  qty: number;              // kontrat adedi
  entry: number;            // ekleme anındaki prim ($/hisse)
  entrySrc: EntrySrc;
  underlyingAdded: number | null;
  addedAt: string;          // ISO
  last: Snapshot | null;
}
export type NewItem = Omit<WatchItem, 'id' | 'addedAt' | 'last'>;

const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** OCC sembolü: KÖK + YYMMDD + C/P + strike×1000 (8 hane). Örn. QQQ 585 Call 20.11.2026 → QQQ261120C00585000 */
export function occSymbol(root: string, expiry: string, type: OptType, strike: number): string {
  if (!SYM.test(root)) throw new Error('Geçersiz sembol');
  const m = DATE.exec(expiry); if (!m) throw new Error('Geçersiz vade');
  const k = Math.round(strike * 1000);
  if (!(k > 0) || k >= 1e8 || Math.abs(k - strike * 1000) > 1e-6) throw new Error('Geçersiz strike');
  return `${root}${m[1].slice(2)}${m[2]}${m[3]}${type === 'call' ? 'C' : 'P'}${String(k).padStart(8, '0')}`;
}

/** Vade doldu mu: vade gününün 16:00 ET kapanışından sonra */
export const isExpired = (expiry: string, now: number) => closeMs(expiry) <= now;

/** Ekleme gününden bu yana tam takvim günü sayısı */
export const daysSince = (addedIso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(addedIso)) / DAY_MS));

const p2 = (x: number) => String(x).padStart(2, '0');
/** İstanbul saati (UTC+3, yaz saati yok): "14.11 15:00" veya tam: "14.11.2026 15:00" */
export function istanbulStamp(ms: number, withYear = false): string {
  const d = new Date(ms + 3 * 3600000);
  const base = `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`;
  return `${withYear ? base + '.' + d.getUTCFullYear() : base} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** Aynı kontrat + aynı yön = tekrar (yinelenen kalem engellenir) */
export const dupKey = (x: Pick<NewItem, 'symbol' | 'expiry' | 'type' | 'strike' | 'side'>) => [x.symbol, x.expiry, x.type, x.strike, x.side].join('|');

/** Yeni kalem: ilk "son bilinen" fiyat ekleme anındaki primdir */
export function makeItem(n: NewItem, now: number, rnd: () => number = Math.random): WatchItem {
  return { ...n, id: now.toString(36) + rnd().toString(36).slice(2, 8), addedAt: new Date(now).toISOString(),
    last: { premium: n.entry > 0 ? n.entry : null, underlying: n.underlyingAdded, at: now } };
}

/** Listeye ekler; mevcut veya aynı çağrıda tekrar eden kontratları atlar */
export function addItems(list: WatchItem[], news: NewItem[], now: number, rnd?: () => number): { list: WatchItem[]; added: number; dup: number } {
  const seen = new Set(list.map(dupKey));
  const out = [...list];
  let added = 0, dup = 0;
  for (const n of news) {
    const k = dupKey(n);
    if (seen.has(k)) { dup++; continue; }
    seen.add(k); out.push(makeItem(n, now, rnd)); added++;
  }
  return { list: out, added, dup };
}

/** Yalnız vadesi dolmamış kalemler için (symbol, expiry) çiftleri — tekrarsız; vadesi dolanlar için istek yok */
export function liveKeys(items: WatchItem[], now: number): { symbol: string; expiry: string }[] {
  const m = new Map<string, { symbol: string; expiry: string }>();
  for (const it of items) if (!isExpired(it.expiry, now)) m.set(it.symbol + '|' + it.expiry, { symbol: it.symbol, expiry: it.expiry });
  return [...m.values()];
}
