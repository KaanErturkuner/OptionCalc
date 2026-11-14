/* ABD piyasası takvimi: US/Eastern saat dilimi (DST dahil), NYSE tatilleri, opsiyon vadeleri */
export const DAY_MS = 86400000;
export const YEAR_MS = 365 * DAY_MS;

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const dow = (s: string) => new Date(s + 'T12:00:00Z').getUTCDay();
export const addDaysStr = (s: string, n: number) => new Date(Date.parse(s + 'T12:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);

function nthWeekday(y: number, m: number, wd: number, n: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(y: number, m: number, wd: number): string {
  const last = new Date(Date.UTC(y, m, 0));
  const d = last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7);
  return ymd(y, m, d);
}
function easter(y: number): string { // Anonymous Gregorian
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, mo, da);
}
/** Sabit tarihli tatil hafta sonuna denk gelirse: Cumartesi→Cuma, Pazar→Pazartesi */
function observed(s: string): string { const w = dow(s); return w === 6 ? addDaysStr(s, -1) : w === 0 ? addDaysStr(s, 1) : s; }

const holCache = new Map<number, Set<string>>();
export function nyseHolidays(y: number): Set<string> {
  let h = holCache.get(y); if (h) return h;
  h = new Set<string>();
  const ny = ymd(y, 1, 1); if (dow(ny) !== 6) h.add(observed(ny)); // 1 Ocak Cumartesi ise tatil yapılmaz
  h.add(nthWeekday(y, 1, 1, 3));            // MLK
  h.add(nthWeekday(y, 2, 1, 3));            // Presidents
  h.add(addDaysStr(easter(y), -2));         // Good Friday
  h.add(lastWeekday(y, 5, 1));              // Memorial
  if (y >= 2022) h.add(observed(ymd(y, 6, 19))); // Juneteenth
  h.add(observed(ymd(y, 7, 4)));            // Independence
  h.add(nthWeekday(y, 9, 1, 1));            // Labor
  h.add(nthWeekday(y, 11, 4, 4));           // Thanksgiving
  h.add(observed(ymd(y, 12, 25)));          // Christmas
  holCache.set(y, h); return h;
}
export function isTradingDay(s: string): boolean {
  const w = dow(s); if (w === 0 || w === 6) return false;
  return !nyseHolidays(+s.slice(0, 4)).has(s);
}
export function prevTradingDay(s: string): string { let d = s; while (!isTradingDay(d)) d = addDaysStr(d, -1); return d; }

/** US/Eastern UTC farkı (saat): EDT −4, EST −5. DST: Mart 2. Pazar 02:00 → Kasım 1. Pazar 02:00 (yerel) */
export function etOffset(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const start = Date.parse(nthWeekday(y, 3, 0, 2) + 'T07:00:00Z'); // 02:00 EST = 07:00 UTC
  const end = Date.parse(nthWeekday(y, 11, 0, 1) + 'T06:00:00Z');  // 02:00 EDT = 06:00 UTC
  return utcMs >= start && utcMs < end ? -4 : -5;
}
/** Verilen anın New York tarihi (YYYY-MM-DD) */
export function etDate(ms: number): string { return new Date(ms + etOffset(ms) * 3600000).toISOString().slice(0, 10); }
function etTime(s: string, hh: number, mm: number): number {
  const [y, m, d] = s.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - etOffset(guess + 5 * 3600000) * 3600000;
}
/** O günün 16:00 ET kapanış anı (UTC ms) */
export const closeMs = (s: string) => etTime(s, 16, 0);
/** Ex-temettü günü açılışı 09:30 ET (fiyat bu anda temettü kadar düşer) */
export const exDivMs = (s: string) => etTime(s, 9, 30);
/** Bugün (ET) için piyasa kapanmış mı */
export const afterClose = (now: number) => now >= closeMs(etDate(now));

export const isMonthly = (s: string) => { // ayın 3. Cuması (tatilse önceki işlem günü)
  const y = +s.slice(0, 4), m = +s.slice(5, 7);
  return prevTradingDay(nthWeekday(y, m, 5, 3)) === s;
};
export interface Expiry { date: string; monthly: boolean; days: number }
/**
 * Yaklaşan ABD opsiyon vadeleri: 9 haftaya kadar haftalık Cuma, 1 yıla kadar aylık (3. Cuma),
 * ardından Ocak LEAPS. Tatile denk gelen Cuma → önceki işlem günü.
 */
export function expirations(now: number, maxYears = 2.6): Expiry[] {
  const today = etDate(now), start = afterClose(now) ? addDaysStr(today, 1) : today;
  const out = new Map<string, Expiry>();
  const lastDay = addDaysStr(today, Math.round(maxYears * 365));
  let f = start; while (dow(f) !== 5) f = addDaysStr(f, 1);
  for (; f <= lastDay; f = addDaysStr(f, 7)) {
    const e = prevTradingDay(f);
    if (e < start) continue;
    const days = Math.round((Date.parse(e) - Date.parse(today)) / DAY_MS), mo = isMonthly(e);
    const keep = days <= 63 || (mo && days <= 366) || (mo && +e.slice(5, 7) === 1);
    if (keep) out.set(e, { date: e, monthly: mo, days });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}
/** Varsayılan vade: ≥21 gün sonraki ilk aylık vade */
export function defaultExpiry(now: number): string {
  const ex = expirations(now);
  return (ex.find(e => e.monthly && e.days >= 21) || ex[0]).date;
}

/** Normal seans açık mı (09:30–16:00 ET, işlem günü) */
export function marketOpen(now = Date.now()): boolean {
  const d = etDate(now); if (!isTradingDay(d)) return false;
  return now >= closeMs(d) - 6.5 * 3600000 && now < closeMs(d);
}

/* Tazelik göstergesi için: erken kapanış (NYSE 13:00 ET) — closeMs / marketOpen / backtest bunu KULLANMAZ */
/** NYSE erken kapanış günleri: Şükran Günü ertesi Cuma, 3 Temmuz, 24 Aralık (yalnız işlem günüyse) */
export function isEarlyCloseDay(s: string): boolean {
  if (!isTradingDay(s)) return false;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (m === 7 && d === 3) return true;
  if (m === 12 && d === 24) return true;
  return s === addDaysStr(nthWeekday(y, 11, 4, 4), 1);
}
/** Gün için seans kapanışı (UTC ms): 16:00 ET, erken kapanış günü 13:00 ET; işlem günü değilse null */
export function sessionCloseMs(s: string): number | null {
  if (!isTradingDay(s)) return null;
  return etTime(s, isEarlyCloseDay(s) ? 13 : 16, 0);
}
/** Şu an normal seans içinde mi (09:30 ET – kapanış, erken kapanış dahil). marketOpen'dan bağımsız. */
export function isSessionOpenNow(now: number): boolean {
  const d = etDate(now), close = sessionCloseMs(d);
  if (close == null) return false;
  return now >= etTime(d, 9, 30) && now < close;
}

/** İstanbul saati "HH:MM" (UTC+3, yaz saati yok). Kullanıcıya gösterilen tüm saatler bu biçimde. */
export const istHM = (ms: number): string => { const d = new Date(ms + 3 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
/** ms'deki ABD takviminde hh:mm ET anının İstanbul "HH:MM" karşılığı (ABD DST'sine göre kayar). */
export const etToIst = (hh: number, mm: number, now = Date.now()): string => istHM(etTime(etDate(now), hh, mm));
