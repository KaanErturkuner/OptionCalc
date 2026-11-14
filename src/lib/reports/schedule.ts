/*
 * Rapor zamanlaması (saf). Her rapor ABD açılışına/kapanışına çapalıdır (ET, DST dâhil); İstanbul saati türetilir:
 *   Piyasa öncesi  = açılış − 30 dk   (kış: 17:00 İst, yaz: 16:00 İst)
 *   Açılış +30 dk  = açılış + 30 dk   (kış: 18:00 İst)
 *   Açılış +1,5 sa = açılış + 90 dk
 *   Açılış +2,5 sa = açılış + 150 dk   (kış: 20:00 İst)
 *   Açılış +3,5 sa = açılış + 210 dk   (kış: 21:00 İst; yaz: 20:00 İst)
 *   Gün sonu       = kapanış + 30 dk  (yaz: 23:30 İst; kış: 00:30 İst)
 * Tatil (NYSE) günlerinde rapor yok. Erken kapanış (13:00 ET) günlerinde gün sonu raporu kapanışa göre kaydırılır.
 * Ağ yok; yalnız usmarket.ts takvimi.
 */
import { addDaysStr, closeMs, etDate, exDivMs, isTradingDay } from '../usmarket.ts';

export type ReportKind = 'premarket' | 'intra1' | 'intra2' | 'intra3' | 'intra4' | 'eod';
export const REPORT_KINDS: ReportKind[] = ['premarket', 'intra1', 'intra2', 'intra3', 'intra4', 'eod'];
/** Ara rapor türleri (rejim, bant, senaryo bölümleri bunlarda) */
export const INTRA_KINDS: ReportKind[] = ['intra1', 'intra2', 'intra3', 'intra4'];
export const KIND_LABEL: Record<ReportKind, string> = {
  premarket: 'Piyasa öncesi', intra1: 'Açılış +30 dk', intra2: 'Açılış +1,5 saat', intra3: 'Açılış +2,5 saat', intra4: 'Açılış +3,5 saat', eod: 'Gün sonu',
};
export interface Slot { key: string; kind: ReportKind; day: string; atMs: number }

const MIN = 60000;
const DAY_OFFSETS: Record<ReportKind, number> = {   // dakika, açılış (intra/pre) ya da kapanış (eod) referansına göre
  premarket: -30, intra1: 30, intra2: 90, intra3: 150, intra4: 210, eod: 30,
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
  const open = exDivMs(day);                                  // 09:30 ET
  const close = isEarlyClose(day) ? closeMs(day) - 3 * 60 * MIN : closeMs(day);
  return REPORT_KINDS.map(kind => {
    const ref = kind === 'eod' ? close : open;
    return { key: `${day}:${kind}`, kind, day, atMs: ref + DAY_OFFSETS[kind] * MIN };
  }).filter(s => s.kind !== 'intra4' || s.atMs < close - 60 * MIN);   // erken kapanışta 21:00 (13:00 ET) = kapanış: atlanır
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
