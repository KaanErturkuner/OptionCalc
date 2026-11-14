/*
 * Akış penceresi (son N İŞLEM günü) ve gün başlıkları. Saf: sunucu (retention, /flow?days=) ve uygulama (gruplama) ortak kullanır.
 * Tatil ve hafta sonları usmarket.ts (NYSE takvimi) ile atlanır. Tüm günler ET takvim günü (YYYY-MM-DD).
 */
import { addDaysStr, etDate, isTradingDay, prevTradingDay } from '../usmarket.ts';

export const FLOW_DAYS_DEFAULT = 3;
export const FLOW_DAYS_MAX = 5;

/** İstenen gün sayısını doğrular: boş/geçersiz → 3, 1..5 aralığına sıkıştırır */
export function clampFlowDays(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return FLOW_DAYS_DEFAULT;
  return Math.min(FLOW_DAYS_MAX, Math.max(1, Math.floor(n)));
}

/**
 * Verilen ET takvim gününden geriye doğru n İŞLEM günü (en yeni önce). Bugün işlem günüyse dahildir;
 * değilse (hafta sonu / tatil) son işlem gününden başlar.
 */
export function tradingDaysEndingAt(todayYmd: string, n: number): string[] {
  const out: string[] = [];
  let d = isTradingDay(todayYmd) ? todayYmd : prevTradingDay(todayYmd);
  for (let i = 0; i < n; i++) {
    out.push(d);
    d = prevTradingDay(addDaysStr(d, -1));
  }
  return out;
}

/** Şu anki ET gününe göre son n işlem günü (en yeni önce) */
export function tradingDaysBack(nowMs: number, n: number): string[] {
  return tradingDaysEndingAt(etDate(nowMs), n);
}

/** Akış penceresinin en eski işlem günü (sorgu alt sınırı ve saklama sınırı için) */
export function oldestTradingDay(nowMs: number, n: number): string {
  const days = tradingDaysBack(nowMs, n);
  return days[days.length - 1];
}

const WEEKDAY = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTH = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/**
 * Gün başlığı: "Bugün" (ET bugünü), "Dün" (bugünden önceki son işlem günü), diğerleri "Cuma, 13 Kasım"
 * (yıl farklıysa "Cuma, 13 Kasım 2026"). Gün YYYY-MM-DD.
 */
export function dayHeaderLabel(day: string, nowMs: number): string {
  const today = etDate(nowMs);
  if (day === today) return 'Bugün';
  if (day === prevTradingDay(addDaysStr(today, -1))) return 'Dün';
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const yearPart = y === Number(today.slice(0, 4)) ? '' : ` ${y}`;
  return `${WEEKDAY[wd]}, ${d} ${MONTH[m - 1]}${yearPart}`;
}

export interface FlowDayGroup<T> { day: string; label: string; items: T[] }

/**
 * Olayları güne göre gruplar (yeni gün önce). Gruptaki olaylar girdi sırasını korur (sunucu yeni → eski döner).
 * Gün alanı `day` (ET takvim günü) kullanılır.
 */
export function groupByDay<T extends { day: string }>(items: T[], nowMs: number): FlowDayGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const arr = map.get(it.day);
    if (arr) arr.push(it); else map.set(it.day, [it]);
  }
  return [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map(day => ({ day, label: dayHeaderLabel(day, nowMs), items: map.get(day)! }));
}
