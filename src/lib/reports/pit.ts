/*
 * Nokta-zamanlı (point-in-time) yeniden kurulum — saf. Geçmiş bir rapor, yalnız rapor anından ÖNCE tamamlanmış veriyle
 * kurulur: bar yalnız t + süre ≤ rapor anıysa kullanılır; daily bar yalnız borsa kapanışı rapor anından önceyse.
 * Ağ YOK. Kullanan: server/app/backfill.ts (sunucuda, MarketData'ya çağrı YOK).
 */
import type { Bar } from './sources.ts';
import type { Report } from './types.ts';
import { closeMs } from '../usmarket.ts';
import { istHm } from './schedule.ts';

const DAY_S = 86400;
export const MIN_MS = 60000;
export const NY_TZ = 'America/New_York';

const fmt = new Map<string, Intl.DateTimeFormat>();
/** Bir ms anının borsa saat diliminde yerel takvim tarihi (YYYY-MM-DD) */
export function localDate(ms: number, tz: string): string {
  let f = fmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); fmt.set(tz, f); }
  return f.format(ms);
}

/** Yahoo period1/period2 (saniye). period2 = rapor anı: bu andan sonrası HİÇ istenmez; daysBack geriye pencere. */
export function pitPeriods(cutoffMs: number, daysBack: number): { period1: number; period2: number } {
  const period2 = Math.floor(cutoffMs / 1000);
  return { period1: period2 - Math.round(daysBack * DAY_S), period2 };
}

/** Bar süresi barMs olan intraday barlar: yalnız tamamlananlar (t + barMs ≤ cutoff) */
export function endedBy(bars: Bar[], barMs: number, cutoffMs: number): Bar[] {
  return bars.filter(b => b.t + barMs <= cutoffMs);
}
/** Rapor anında son tamamlanmış bar (yoksa null) */
export function lastEndedBy(bars: Bar[], barMs: number, cutoffMs: number): Bar | null {
  const xs = endedBy(bars, barMs, cutoffMs);
  return xs.length ? xs[xs.length - 1] : null;
}

/** Günlük barlar: yalnız ABD kapanışı (16:00 ET) rapor anından önce olanlar (gün bitmeden kapanış kullanılmaz) */
export function dailyDoneBy(daily: Bar[], cutoffMs: number): Bar[] {
  return daily.filter(b => closeMs(localDate(b.t, NY_TZ)) <= cutoffMs);
}

/** Referans tarihten ÖNCEKİ son günlük kapanış (referans günün kendi barı kullanılmaz) */
export function prevCloseBefore(daily: Bar[], refDate: string, tz: string): number | null {
  for (let i = daily.length - 1; i >= 0; i--) if (localDate(daily[i].t, tz) < refDate) return daily[i].c;
  return null;
}

/** Yahoo intraday kotasyonu (rapor anı): son tamamlanmış barın kapanışı ve yerel tarihi `expectDate` ile eşleşmeli */
export function pitPrice(intraday: Bar[], barMs: number, cutoffMs: number, tz: string, expectDate: string): number | null {
  const b = lastEndedBy(intraday, barMs, cutoffMs);
  return b && localDate(b.t, tz) === expectDate ? b.c : null;
}

/** Açılış fiyatı: gün başlangıcından (ör. 09:30 ET) sonraki ilk barın açılışı ve rapor anına kadar son kapanış */
export function openAndLast(intraday: Bar[], barMs: number, cutoffMs: number, dayStartMs: number): { open: number | null; last: number | null } {
  const open = intraday.find(b => b.t >= dayStartMs && b.o != null)?.o ?? null;
  return { open, last: lastEndedBy(intraday, barMs, cutoffMs)?.c ?? null };
}

/** Rapor etiketi: örnek raporu açıkça işaretler (başlık öneki + gövde notu). Girdi değişmez. */
export function exampleReport(rep: Report): Report {
  const note = `ÖRNEK RAPOR — ${rep.day} için geçmiş yeniden kurulum. Yalnızca ${istHm(rep.ts)} İst'ten önce tamamlanmış veriyle üretildi; sonraki veri kullanılmadı.`;
  return { ...rep, title: `Örnek · ${rep.title}`, body: `${note}\n\n${rep.body}` };
}
