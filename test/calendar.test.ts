/* Gece taşıma takvim kapısı (D12): bilanço + FOMC/CPI/NFP. Saf; ağ yok. */
import { calendarCheck, MACRO_CALENDAR, type MacroSeries } from '../src/lib/calendar/events.ts';
import { overnightDecision } from '../src/lib/paper/overnight.ts';
import type { OpenPosition } from '../src/lib/paper/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };

// Kapsamı tam bir test tablosu: CPI 2026-11-13 olayı, tüm 2026 kapsamlı.
const T: MacroSeries[] = [
  { kind: 'CPI', from: '2026-01-01', to: '2026-12-31', dates: ['2026-11-13'] },
  { kind: 'NFP', from: '2026-01-01', to: '2026-12-31', dates: [] },
];
const clean = { kind: 'yok' } as const;

// Makro olay
ok('CPI günü (bugün) → engel', !calendarCheck('2026-11-13', '2026-11-16', clean, T).ok);
ok('CPI ertesi işlem günü → engel (açılış öncesi açıklama)', !calendarCheck('2026-11-12', '2026-11-13', clean, T).ok);
ok('olay yok, kapsam tam → temiz', calendarCheck('2026-11-16', '2026-11-17', clean, T).ok);
ok('olay sebebi Türkçe ve tarihi içerir', calendarCheck('2026-11-13', '2026-11-16', clean, T).reasons.join(' ').includes('CPI olayı 2026-11-13'));

// Kapsam dışı (bilinmiyor) → taşıma yok
ok('kapsam öncesi (CPI 2026-11 öncesi yok) → engel', !calendarCheck('2026-05-05', '2026-05-06', clean, MACRO_CALENDAR).ok);
ok('kapsam dışı tarih (2027) → engel', !calendarCheck('2027-02-02', '2027-02-03', clean, T).ok);

// Varsayılan tablo (resmi BLS/Fed, CPI/NFP kapsamı 2026-11-01'den): kapsam öncesi → engel (güvenli taraf)
{
  const r = calendarCheck('2026-03-19', '2026-03-20', { kind: 'etf' }, MACRO_CALENDAR);
  ok('varsayılan tablo: CPI/NFP kapsamı öncesi → ok=false', r.ok === false && r.reasons.some(x => x.startsWith('CPI takvimi')), JSON.stringify(r));
  ok('varsayılan tablo: 2026-11-13 → 11-16, olay yok → ETF taşınabilir', calendarCheck('2026-11-13', '2026-11-16', { kind: 'etf' }, MACRO_CALENDAR).ok);
  const dec = calendarCheck('2026-12-09', '2026-12-10', { kind: 'etf' }, MACRO_CALENDAR);
  ok('varsayılan tablo: 12-09 FOMC + 12-10 CPI → engel', !dec.ok && dec.reasons.some(x => x.includes('FOMC')) && dec.reasons.some(x => x.includes('CPI')), JSON.stringify(dec));
  ok('varsayılan tablo: NFP 2026-12-04 öncesi gece → engel', !calendarCheck('2026-12-03', '2026-12-04', { kind: 'etf' }, MACRO_CALENDAR).ok);
  ok('varsayılan tablo: kapsam sonu (2028) → engel', !calendarCheck('2027-12-31', '2028-01-03', { kind: 'etf' }, MACRO_CALENDAR).ok);
}
ok('FOMC karar günü tablo içinde → engel (kapsam tam seri)', !calendarCheck('2026-03-18', '2026-03-19', { kind: 'etf' },
  [{ kind: 'FOMC', from: '2026-01-01', to: '2026-12-31', dates: ['2026-03-18'] }]).ok);

// Bilanço
ok('bilanço penceredeyse (ertesi gün) → engel', !calendarCheck('2026-11-16', '2026-11-17', { kind: 'var', date: '2026-11-17' }, []).ok);
ok('bilanço pencere dışı → temiz', calendarCheck('2026-11-16', '2026-11-17', { kind: 'var', date: '2026-11-20' }, []).ok);
ok('bilanço bilinmiyor → engel (anahtar yok / hata)', !calendarCheck('2026-11-16', '2026-11-17', { kind: 'bilinmiyor' }, []).ok);
ok('ETF: bilanço kontrolü yok → temiz', calendarCheck('2026-11-16', '2026-11-17', { kind: 'etf' }, []).ok);
ok('sorgu yapıldı, bilanço yok → temiz', calendarCheck('2026-11-16', '2026-11-17', { kind: 'yok' }, []).ok);

// Gece kararına bağlama: takvim engeli varsa taşınmaz, sebep karara girer
const pos: OpenPosition = {
  id: 'p', ticker: 'NVDA', setup: 'S1', dir: 'call', expiry: '2026-11-18', dte: 2, strike: 100, contracts: 1, fill: 1, costBasis: 100,
  openComm: 0, stopPrem0: 0.6, stopPrem: 0.6, targetPrem: 3, rPrice: 0.4, rDollars: 40, targetR: 3, openedAt: 0, day: '2026-11-16',
  mode: 'AGRESIF', kademe: 0.5, overnight: false, maxR: 0, warned: false,
};
{
  const cal = calendarCheck('2026-11-16', '2026-11-17', { kind: 'var', date: '2026-11-16' }, []);
  const d = overnightDecision({ pos, day: '2026-11-16', S: 100, ivAtm: 0.2, calendar: cal, strongTriggerLast30: false, regimeAligned: true, pricer: () => 0.9 });
  ok('gece: bilanço engeli → taşınmaz, sebep karara yazılır', !d.carry && d.reasons.some(r => r.includes('bilanço')), JSON.stringify(d.reasons));
  const clear = overnightDecision({ pos, day: '2026-11-16', S: 100, ivAtm: 0.2, calendar: { ok: true, reasons: [] }, strongTriggerLast30: false, regimeAligned: true, pricer: () => 0.9 });
  ok('gece: takvim temiz → taşınır', clear.carry, JSON.stringify(clear.reasons));
}

console.log(fail ? `\n${fail} test başarısız` : '\nTakvim testleri geçti');
if (fail) process.exit(1);
