/*
 * Rapor zamanlaması (saf). Kaan kararı (2026-11-14): SABİT İstanbul saatleri, işlem günlerinde (DST'den bağımsız):
 *   17:00 Piyasa öncesi · 18:00, 19:00, 20:00, 21:00, 22:00, 23:00 ara raporlar (intra1..intra6) · 23:50 Gün sonu
 * Erken kapanış (13:00 ET) günlerinde kapanıştan sonraki ara raporlar atlanır, gün sonu kapanış + 30 dk'ya çekilir.
 * Tatil (NYSE) günlerinde rapor yok. Erken kapanış (13:00 ET) günlerinde gün sonu raporu kapanışa göre kaydırılır.
 * Ağ yok; yalnız usmarket.ts takvimi.
 */
import { addDaysStr, closeMs, etDate, exDivMs, isTradingDay } from '../usmarket.ts';

export type ReportKind = 'premarket' | 'intra1' | 'intra2' | 'intra3' | 'intra4' | 'intra5' | 'intra6' | 'eod';
export const REPORT_KINDS: ReportKind[] = ['premarket', 'intra1', 'intra2', 'intra3', 'intra4', 'intra5', 'intra6', 'eod'];
/** Ara rapor türleri (rejim, bant, senaryo bölümleri bunlarda) */
export const INTRA_KINDS: ReportKind[] = ['intra1', 'intra2', 'intra3', 'intra4', 'intra5', 'intra6'];
export const KIND_LABEL: Record<ReportKind, string> = {
  premarket: 'Piyasa öncesi', intra1: 'Ara rapor 18:00', intra2: 'Ara rapor 19:00', intra3: 'Ara rapor 20:00', intra4: 'Ara rapor 21:00',
  intra5: 'Ara rapor 22:00', intra6: 'Ara rapor 23:00', eod: 'Gün sonu',
};
export interface Slot { key: string; kind: ReportKind; day: string; atMs: number }

const MIN = 60000;
/** Sabit İstanbul saatleri (SS:DD, UTC+3) */
export const IST_TIMES: Record<ReportKind, string> = {
  premarket: '17:00', intra1: '18:00', intra2: '19:00', intra3: '20:00', intra4: '21:00', intra5: '22:00', intra6: '23:00', eod: '23:50',
};

/** İkinci Pazar … (ayın n. günü) yardımcı: (y, m 1-12, weekday 0=Paz, n) → YYYY-MM-DD */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * NYSE erken kapanış (13:00 ET) günleri: Şükran Günü'nün ertesi Cuma; 24 Aralık (işlem günüyse);
 * 3 Temmuz (işlem günüyse). Yıllık NYSE takvimiyle doğrulanmalıdır (tablo kural tabanlıdır).
 */
export function isEarlyClose(day: string): boolean {
  if (!isTradingDay(day)) return false;
  const y = +day.slice(0, 4);
  if (day === addDaysStr(nthWeekday(y, 11, 4, 4), 1)) return true;   // Şükran Günü ertesi
  if (day.endsWith('-12-24')) return true;
  if (day.endsWith('-07-03')) return true;
  return false;
}

/** Bir ET işlem gününün rapor slotları (tatilde boş) */
export function slotsFor(day: string): Slot[] {
  if (!isTradingDay(day)) return [];
  const early = isEarlyClose(day);
  const close = early ? closeMs(day) - 3 * 60 * MIN : closeMs(day);
  return REPORT_KINDS.map(kind => ({ key: `${day}:${kind}`, kind, day, atMs: Date.parse(`${day}T${IST_TIMES[kind]}:00+03:00`) }))
    .filter(s => !early || s.kind === 'eod' || s.atMs < close)                       // erken kapanış: kapanıştan sonraki ara raporlar yok
    .map(s => (early && s.kind === 'eod' ? { ...s, atMs: close + 30 * MIN } : s));
}

/**
 * Şu an vakti gelmiş ama henüz çok geç olmayan slotlar (ET takvim günü). grace: sunucu yeniden başlarsa
 * geçmiş raporlar üretilmez (gecikmesi graceMs'i aşan slot atlanır). Üretilmiş olanı çağıran elemeli.
 */
export function dueSlots(nowMs: number, graceMs = 45 * MIN): Slot[] {
  const day = etDate(nowMs);
  return slotsFor(day).filter(s => nowMs >= s.atMs && nowMs - s.atMs < graceMs);
}

/** Dakika → İstanbul saati SS:DD (UTC+3) — test ve metin için */
export function istHm(ms: number): string {
  const d = new Date(ms + 3 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
