/*
 * Ekonomik veri yayın takvimi (2026) — saf TS veri + saat yardımcıları. Ağ yok.
 *
 * Neden var: MACRO_CALENDAR (events.ts) yalnız FOMC/CPI/NFP içerir ve gece taşıma kapısını (D12) besler. Raporlar ve
 * Sonuç kartı aynı tabloyu kullandığı için PPI gibi diğer önemli veriler "önemli bir şey yok" olarak görünüyordu
 * (2026-11-13, Cuma: PPI 08:30 ET = 16:30 İst). Bu dosya o eksiği kapatır.
 *
 * Kapsam kararı: BLOCKING (FOMC/CPI/NFP) kümesi DEĞİŞMEZ — gece kapısı yalnız events.ts'teki seriyi kullanır.
 * Buradaki diğer olaylar yalnız UYARI'dır (releaseWarnings, Sonuç kartı, raporlar).
 *
 * Doğrulama (retrieval 2026-11-14). verified=true → resmi sayfada görüldü. verified=false → ikincil kaynak, kural
 * veya aritmetik; kullanıcıya "tarih doğrulanmadı" olarak gösterilir.
 *  - PPI:        https://www.bls.gov/schedule/news_release/ppi.htm  (sayfa Ekim/Kasım ref. dönemini listeler; Oca–Eyl 2026 satırları sayfada yok)
 *  - JOLTS:      https://www.bls.gov/schedule/news_release/jolts.htm (Ekim ref. 01.12.2026 10:00 doğrulandı)
 *  - PCE/GSYH:   https://www.bea.gov/news/schedule/full (2026 tüm satırlar; saat dilimi sayfada yazılı değil → ET varsayıldı, BEA standardı 08:30)
 *  - Perakende:  https://www.census.gov/economic-indicators/calendar-listview-2026.html (13 satır, 08:30)
 *  - FOMC:       https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (karar + tutanak 2026 satırları; "Last Update 12 Kas 2026")
 *  - UMich:      https://www.sca.isr.umich.edu/ (yalnız Kasım nihai 20.11.2026 10:00 ET ana sayfada doğrulandı)
 *  - ISM:        ismworld.org takvimi okunamadı (giriş sayfasına yönlendiriyor) → ikincil kaynaklar (financecalendar, therighttrader)
 *                + kural: imalat = ayın 1. iş günü 10:00 ET; hizmet = 3. iş günü 10:00 ET. verified=false.
 *  - İşsizlik başvuruları: DOL takvimi okunamadı. Kural: her Perşembe 08:30 ET; Perşembe federal/NYSE tatilse bir önceki gün.
 *                Şükran Günü 26.11.2026 → 25.11.2026 (ikincil kaynaklar). verified=false.
 *  - FOMC tutanakları: Fed 2026 tutanak tarihleri (karar + 21 gün, 14:00 ET). Ekim ve Aralık tutanakları Fed'de henüz yok → aritmetik, verified=false.
 * Yılda bir (ve Fed/BLS/BEA takvimi revize olursa) güncellenmeli. Kapsam dışı tarihler için boş döner (bilinmiyor).
 */
import { MACRO_CALENDAR } from './events.ts';
import { addDaysStr, etDate, isTradingDay, nyseHolidays } from '../usmarket.ts';

export type Tier = 'high' | 'medium';
/** Bir yayın olayı. time: ET saati (HH:MM). day: ET tarih (YYYY-MM-DD). */
export interface CalEvent { key: string; short: string; label: string; tier: Tier; day: string; time: string; verified: boolean; src: string }
export type MacroLite = CalEvent;

const ET = 'America/New_York';
const IST = 'Europe/Istanbul';

const SRC = {
  cpi: 'https://www.bls.gov/schedule/news_release/cpi.htm',
  nfp: 'https://www.bls.gov/schedule/news_release/empsit.htm',
  fed: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  ppi: 'https://www.bls.gov/schedule/news_release/ppi.htm',
  jolts: 'https://www.bls.gov/schedule/news_release/jolts.htm',
  bea: 'https://www.bea.gov/news/schedule/full',
  census: 'https://www.census.gov/economic-indicators/calendar-listview-2026.html',
  umich: 'https://www.sca.isr.umich.edu/',
  ism: 'https://www.financecalendar.com/event/us-ism-manufacturing-pmi-december-2026/',
  claims: 'https://www.dol.gov/ui/data.pdf',
} as const;

/** Blokaj kümesi (gece kapısı, events.ts). Bu olaylar yalnız UYARI değil, taşımayı engeller. */
export const BLOCKING_KEYS = new Set(['FOMC', 'CPI', 'NFP']);

interface Meta { short: string; label: string; tier: Tier; time: string; src: string }
const META: Record<string, Meta> = {
  FOMC: { short: 'FOMC', label: 'FOMC faiz kararı', tier: 'high', time: '14:00', src: SRC.fed },
  CPI: { short: 'CPI', label: 'CPI enflasyon', tier: 'high', time: '08:30', src: SRC.cpi },
  NFP: { short: 'NFP', label: 'İstihdam (NFP)', tier: 'high', time: '08:30', src: SRC.nfp },
  PPI: { short: 'PPI', label: 'PPI (üretici fiyatları)', tier: 'high', time: '08:30', src: SRC.ppi },
  PCE: { short: 'PCE', label: 'PCE / çekirdek PCE (kişisel gelir ve harcama)', tier: 'high', time: '08:30', src: SRC.bea },
  GDP: { short: 'GSYH', label: 'GSYH (çeyreklik büyüme)', tier: 'high', time: '08:30', src: SRC.bea },
  RETAIL: { short: 'Perakende satış', label: 'Perakende satışları (aylık)', tier: 'high', time: '08:30', src: SRC.census },
  CLAIMS: { short: 'İşsizlik başvurusu', label: 'Haftalık ilk işsizlik başvuruları', tier: 'medium', time: '08:30', src: SRC.claims },
  ISM_MFG: { short: 'ISM İmalat', label: 'ISM imalat PMI', tier: 'medium', time: '10:00', src: SRC.ism },
  ISM_SVC: { short: 'ISM Hizmet', label: 'ISM hizmet PMI', tier: 'medium', time: '10:00', src: SRC.ism },
  JOLTS: { short: 'JOLTS', label: 'JOLTS (açık iş ilanları)', tier: 'medium', time: '10:00', src: SRC.jolts },
  UMICH: { short: 'UMich', label: 'UMich tüketici güveni', tier: 'medium', time: '10:00', src: SRC.umich },
  MINUTES: { short: 'FOMC tutanağı', label: 'FOMC toplantı tutanağı', tier: 'medium', time: '14:00', src: SRC.fed },
};

type Row = [day: string, verified: boolean, time?: string];
const rows = (key: keyof typeof META | string, list: Row[]): Omit<CalEvent, never>[] =>
  list.map(([day, verified, time]) => ({ key, ...META[key], time: time ?? META[key].time, day, verified, src: META[key].src }));

/** Yayın tablosu (MACRO_CALENDAR dışı). Yalnız 2026 satırları; sayfada olmayanlar eklenmedi. */
export const RELEASES: CalEvent[] = [
  ...rows('PPI', [['2026-11-13', true], ['2026-12-15', true]]),
  ...rows('PCE', [
    ['2026-01-22', true, '10:00'], ['2026-02-20', true], ['2026-03-13', true], ['2026-04-09', true], ['2026-04-30', true],
    ['2026-05-28', true], ['2026-06-25', true], ['2026-07-30', true], ['2026-08-26', true], ['2026-09-30', true],
    ['2026-10-29', true], ['2026-11-25', true], ['2026-12-23', true],
  ]),
  ...rows('GDP', [
    ['2026-01-22', true], ['2026-02-20', true], ['2026-03-13', true], ['2026-04-09', true], ['2026-04-30', true],
    ['2026-05-28', true], ['2026-06-25', true], ['2026-07-30', true], ['2026-08-26', true], ['2026-09-30', true],
    ['2026-10-29', true], ['2026-11-25', true], ['2026-12-23', true],
  ]),
  ...rows('RETAIL', [
    ['2026-01-14', true], ['2026-02-10', true], ['2026-03-06', true], ['2026-04-01', true], ['2026-04-21', true],
    ['2026-05-14', true], ['2026-06-17', true], ['2026-07-16', true], ['2026-08-14', true], ['2026-09-16', true],
    ['2026-10-15', true], ['2026-11-17', true], ['2026-12-16', true],
  ]),
  ...rows('JOLTS', [['2026-12-01', true]]),
  ...rows('ISM_MFG', [['2026-11-02', false], ['2026-12-01', false]]),
  ...rows('ISM_SVC', [['2026-11-04', false], ['2026-12-03', false]]),
  ...rows('UMICH', [['2026-11-20', true], ['2026-12-04', false], ['2026-12-18', false]]),
  ...rows('MINUTES', [
    ['2026-02-18', true], ['2026-04-08', true], ['2026-05-20', true], ['2026-07-08', true], ['2026-08-19', true],
    ['2026-10-07', true], ['2026-11-18', false], ['2026-12-30', false],
  ]),
];

const wd = (day: string): number => new Date(day + 'T12:00:00Z').getUTCDay();   // 0=Paz … 4=Per

const partsFmt = new Map<string, Intl.DateTimeFormat>();
/** Bir ms anının verilen saat dilimindeki duvar saatini (UTC tabanlı sayı olarak) döndürür. */
function wallOf(ms: number, tz: string): number {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    partsFmt.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Yerel duvar saati (day + HH:MM, tz) → UTC ms. DST'e göre iki geçişle düzeltilir (yaz/kış ayrımı). */
export function wallToMs(day: string, hhmm: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall - (wallOf(wall, tz) - wall);
  t = wall - (wallOf(t, tz) - t);
  return t;
}

/** ET (New York) yerel saat → UTC ms. */
export const etMs = (day: string, hhmm: string): number => wallToMs(day, hhmm, ET);

const istFmt = new Intl.DateTimeFormat('en-GB', { timeZone: IST, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
/** UTC ms → İstanbul saati HH:MM (saat dilimi Intl ile; sabit +3 yazılmaz). */
export const istHmOf = (ms: number): string => istFmt.format(ms);

/** Sonraki ABD işlem günü (ET tarih). */
export function nextTd(day: string): string {
  let d = addDaysStr(day, 1);
  while (!isTradingDay(d)) d = addDaysStr(d, 1);
  return d;
}

/**
 * İşsizlik başvuruları: Perşembe yayımlanır; Perşembe federal/NYSE tatilse bir önceki gün (Çarşamba).
 * thu = Perşembe tarihi → yayın günü.
 */
export function claimsDayFor(thu: string): string {
  return nyseHolidays(+thu.slice(0, 4)).has(thu) ? addDaysStr(thu, -1) : thu;
}

/** Bu ET günü bir başvuru yayını var mı? (Perşembe, ya da Çarşamba ve ertesi Perşembe tatilse) */
export function claimsOn(day: string): boolean {
  const w = wd(day);
  if (w === 4) return claimsDayFor(day) === day;
  if (w === 3) return claimsDayFor(addDaysStr(day, 1)) === day;
  return false;
}

/** Bir ET gününün tüm yayın olayları (MACRO_CALENDAR FOMC/CPI/NFP + RELEASES + başvuru), saate göre sıralı. */
export function eventsOn(day: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const s of MACRO_CALENDAR) {
    if (!s.dates.includes(day)) continue;
    out.push({ key: s.kind, ...META[s.kind], day, verified: true, src: META[s.kind].src });
  }
  for (const e of RELEASES) if (e.day === day) out.push(e);
  if (claimsOn(day)) out.push({ key: 'CLAIMS', ...META.CLAIMS, day, verified: false, src: SRC.claims });
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.key.localeCompare(b.key));
}

/** Gece kapısı dışındaki önemli (high/medium) olaylar — yalnız UYARI. */
export function releaseWarnings(day: string, nextDay: string): string[] {
  const one = (d: string, when: string) => eventsOn(d)
    .filter(e => !BLOCKING_KEYS.has(e.key))
    .map(e => `${when} ${e.label} ${e.time} ET (${istHmOf(etMs(d, e.time))} İst)${e.verified ? '' : ' — tarih doğrulanmadı'}`);
  return [...one(day, 'bugün'), ...one(nextDay, 'yarın')];
}

/**
 * Sonuç kartı satırları (şimdiki an): bugün ve yarın önemli (high/medium) olaylar.
 * Örnek: "⚠️ bugün PPI 16:30 İst" (geçmişse "· açıklandı").
 */
export function cardCalendarLines(nowMs: number): string[] {
  const today = etDate(nowMs), tomorrow = nextTd(today);
  const line = (e: CalEvent, when: string) => {
    const ms = etMs(e.day, e.time);
    const status = when === 'bugün' ? (ms <= nowMs ? ' · açıklandı' : '') : '';
    return `⚠️ ${when} ${e.short} ${istHmOf(ms)} İst${status}${e.verified ? '' : ' · tarih doğrulanmadı'}`;
  };
  return [
    ...eventsOn(today).map(e => line(e, 'bugün')),
    ...eventsOn(tomorrow).map(e => line(e, 'yarın')),
  ];
}
