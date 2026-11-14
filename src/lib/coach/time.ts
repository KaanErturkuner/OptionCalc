/*
 * Koç zaman yardımcıları (saf). Kaan'ın giriş penceresi İstanbul saatine göre: 16:30–20:00 (UTC+3, yaz saati yok).
 * Midas ekran görüntüleri İstanbul saatini gösterir varsayımıyla: "YYYY-MM-DDTHH:MM" → ms (+03:00).
 */
import { etDate, etOffset } from '../usmarket.ts';

const IST_OFFSET_MS = 3 * 3600000;
const DAY_MS = 86400000;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DDTHH:MM" (İstanbul) → epoch ms; geçersizse null */
export function istToMs(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

/** epoch ms → İstanbul "HH:MM" */
export function istHm(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** epoch ms → İstanbul takvim günü (YYYY-MM-DD) */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** epoch ms → İstanbul dakika (0–1439) */
export function istMinutesOf(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Kaan'ın giriş penceresi: İstanbul 16:30 ≤ t < 20:00 */
export const inEntryWindowIst = (ms: number): boolean => { const m = istMinutesOf(ms); return m >= 16 * 60 + 30 && m < 20 * 60; };

/** ET işlem günü (YYYY-MM-DD) */
export const etDay = (ms: number): string => etDate(ms);

/** ET dakika (0–1439) */
export function etMinutesOf(ms: number): number {
  const e = ms + etOffset(ms) * 3600000;
  return Math.floor(((e / 60000) % 1440 + 1440) % 1440);
}

/** İki YMD arasındaki takvim günü farkı (b − a). Geçersizse null */
export function ymdDiff(a: string, b: string): number | null {
  if (!YMD_RE.test(a) || !YMD_RE.test(b)) return null;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

/** Vade DTE'si: giriş günü → son işlem günü arası takvim günü. Negatif/geçersiz → null */
export function dteOf(expiry: string, entryDay: string): number | null {
  const d = ymdDiff(entryDay, expiry);
  return d == null || d < 0 ? null : d;
}
