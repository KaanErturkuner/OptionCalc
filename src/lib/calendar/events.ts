/* Gece taşıma takvim kapısı (D12, Kaan 2026-11-13): 1–3 DTE pozisyon yalnız bilanço + FOMC/CPI/NFP kontrolünden sonra
 * gece taşınır. Olay varsa veya takvim bilinmiyorsa 15:45 ET'de kapanır (güvenli taraf: taşıma yok). Saf; ağ çağrısı yok.
 *
 * Gece penceresi: bugünkü işlem günü (day) ve ertesi işlem günü (nextDay). Olay bu iki günden birindeyse engel.
 * Bir seri, tablonun kapsadığı tarihler dışında kalan bir gün için "bilinmiyor" sayılır → taşıma yok.
 *
 * Tarih tablosu (MACRO_CALENDAR) resmi kaynaklardan (Başkan doğruladı, 2026-11-13):
 *  - FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (karar günü = toplantının 2. günü, 14:00 ET; 2027 geçici).
 *  - CPI:  https://www.bls.gov/schedule/news_release/cpi.htm (08:30 ET)
 *  - NFP:  https://www.bls.gov/schedule/news_release/empsit.htm (İstihdam Durumu, 08:30 ET)
 * Kapsam dışı (2027-12-31 sonrası) → bilinmiyor → taşıma yok. Tablo yılda bir güncellenmeli (BLS/Fed takvimi değişirse de).
 */

export type MacroKind = 'FOMC' | 'CPI' | 'NFP';
/** Bir makro serisi: kapsam aralığı (ET, yyyy-mm-dd, dâhil) ve olay günleri. Kapsam boşsa seri bilinmiyor sayılır. */
export interface MacroSeries { kind: MacroKind; from: string; to: string; dates: string[] }

export const MACRO_CALENDAR: MacroSeries[] = [
  { kind: 'FOMC', from: '2026-01-01', to: '2027-12-31',
    dates: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
      '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-11-17'] },
  { kind: 'CPI', from: '2026-11-01', to: '2027-12-31',
    dates: ['2026-11-10', '2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10',
      '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'] },
  { kind: 'NFP', from: '2026-11-01', to: '2027-12-31',
    dates: ['2026-11-06', '2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04',
      '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'] },
];

/** Bilanço bilgisi: ETF'lerin bilançosu yoktur; hisseler için sorgu sonucu. */
export type EarningsInfo =
  | { kind: 'etf' }
  | { kind: 'yok' }                 // sorgu yapıldı, pencerede bilanço yok
  | { kind: 'var'; date: string }   // pencerede bilanço (ET tarih)
  | { kind: 'bilinmiyor' };         // anahtar yok, ağ hatası: güvenli taraf → taşıma yok

export const ETF_TICKERS = ['QQQ', 'SPY', 'IWM', 'SMH', 'GLD', 'SLV', 'TLT', 'XLK'] as const;
export const isEtf = (ticker: string): boolean => (ETF_TICKERS as readonly string[]).includes(ticker.toUpperCase());

export interface CalendarCheck { ok: boolean; reasons: string[] }

const covered = (s: MacroSeries, d: string): boolean => !!s.from && !!s.to && d >= s.from && d <= s.to;

/**
 * Gece taşıma kapısı. ok = true yalnızca her seri pencereyi kapsıyor, olay yok ve bilanço penceresi temiz.
 * Sebepler Türkçe; gece kararında (overnight.ts) aynen taşınır.
 */
export function calendarCheck(day: string, nextDay: string, earnings: EarningsInfo, series: MacroSeries[] = MACRO_CALENDAR): CalendarCheck {
  const reasons: string[] = [];
  for (const s of series) {
    if (!covered(s, day) || !covered(s, nextDay)) { reasons.push(`${s.kind} takvimi bu tarihleri kapsamıyor`); continue; }
    const hit = s.dates.find(d => d === day || d === nextDay);
    if (hit) reasons.push(`${s.kind} olayı ${hit}`);
  }
  if (earnings.kind === 'bilinmiyor') reasons.push('bilanço tarihi bilinmiyor');
  else if (earnings.kind === 'var' && earnings.date >= day && earnings.date <= nextDay) reasons.push(`bilanço ${earnings.date}`);
  return { ok: reasons.length === 0, reasons };
}
