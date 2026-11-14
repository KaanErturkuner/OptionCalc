// Yayın takvimi (PPI/PCE/perakende/GSYH/başvurular/ISM/JOLTS/UMich/tutanak): tarih araması, DST'li İstanbul saati,
// başvuru tatil kayması, gece kapısı (blokaj kümesi DEĞİŞMEDİ) ve Sonuç/rapor metni. Ağ YOK.
import { eventsOn, releaseWarnings, cardCalendarLines, etMs, istHmOf, claimsOn, claimsDayFor, RELEASES, BLOCKING_KEYS } from '../src/lib/calendar/releases.ts';
import { calendarCheck, MACRO_CALENDAR, type MacroSeries } from '../src/lib/calendar/events.ts';
import { overnightDecision } from '../src/lib/paper/overnight.ts';
import { buildReport } from '../src/lib/reports/text.ts';
import type { OpenPosition } from '../src/lib/paper/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };

// 1) 2026-11-13 (Cuma): PPI var, 08:30 ET = 16:30 İst (kış saati)
{
  const ev = eventsOn('2026-11-13');
  const ppi = ev.find(e => e.key === 'PPI');
  ok('2026-11-13 PPI olayı var', !!ppi, JSON.stringify(ev.map(e => e.key)));
  ok('PPI saati 08:30 ET', ppi?.time === '08:30' && ppi?.verified === true);
  ok('PPI İstanbul saati 16:30 (EST)', istHmOf(etMs('2026-11-13', '08:30')) === '16:30', istHmOf(etMs('2026-11-13', '08:30')));
  ok('2026-11-13 blokaj kümesinde değil (uyarı)', !BLOCKING_KEYS.has('PPI'));
  ok('uyarı listesinde PPI var', releaseWarnings('2026-11-13', '2026-11-16').some(w => w.includes('PPI')));
}

// 2) DST: İstanbul sabit, ET değişir → İstanbul saati kayar (sabit +3 yazılmaz)
{
  ok('yaz (EDT, 15 Tem): 08:30 ET = 15:30 İst', istHmOf(etMs('2026-07-15', '08:30')) === '15:30', istHmOf(etMs('2026-07-15', '08:30')));
  ok('ilkbahar öncesi (6 Mar, EST): 16:30 İst', istHmOf(etMs('2026-03-06', '08:30')) === '16:30');
  ok('DST başlangıcı sonrası (9 Mar, EDT): 15:30 İst', istHmOf(etMs('2026-03-09', '08:30')) === '15:30');
  ok('DST bitişi öncesi (30 Eki, EDT): 15:30 İst', istHmOf(etMs('2026-10-30', '08:30')) === '15:30');
  ok('DST bitişi sonrası (2 Kas, EST): 16:30 İst', istHmOf(etMs('2026-11-02', '08:30')) === '16:30');
}

// 3) İşsizlik başvuruları: Perşembe; Şükran Günü (26 Kas 2026) → Çarşamba 25 Kas
{
  ok('başvuru 26 Kas 2026 (Şükran) değil; 25 Kas var', !claimsOn('2026-11-26') && claimsOn('2026-11-25'));
  ok('başvuru 3 Ara 2026 (Perşembe) var', claimsOn('2026-12-03'));
  ok('claimsDayFor(Şükran Perşembesi) = Çarşamba', claimsDayFor('2026-11-26') === '2026-11-25');
  ok('claimsDayFor(1 Oca 2026 Perşembe, tatil) = 31 Ara 2025', claimsDayFor('2026-01-01') === '2025-12-31', claimsDayFor('2026-01-01'));
  ok('normal Perşembe kaymaz', claimsDayFor('2026-11-19') === '2026-11-19');
  ok('25 Ara 2026 (Cuma Noel): Perşembe 24 Ara normal', claimsOn('2026-12-24') && !claimsOn('2026-12-25'));
  ok('başvuru olayı doğrulanmadı işaretli', eventsOn('2026-11-25').some(e => e.key === 'CLAIMS' && !e.verified));
}

// 4) Tablo kapsamı: PPI/PCE/GSYH/perakende/JOLTS/UMich/tutanak; FOMC/CPI/NFP gün kümesi değişmedi
{
  const keys = new Set(RELEASES.map(e => e.key));
  for (const k of ['PPI', 'PCE', 'GDP', 'RETAIL', 'JOLTS', 'ISM_MFG', 'ISM_SVC', 'UMICH', 'MINUTES']) ok(`tablo içeriyor: ${k}`, keys.has(k));
  ok('PCE 2026-11-25 (Ekim) ve 2026-12-23 var', RELEASES.some(e => e.key === 'PCE' && e.day === '2026-11-25') && RELEASES.some(e => e.key === 'PCE' && e.day === '2026-12-23'));
  ok('perakende 2026-11-17 ve 2026-12-16 var', RELEASES.some(e => e.key === 'RETAIL' && e.day === '2026-11-17') && RELEASES.some(e => e.key === 'RETAIL' && e.day === '2026-12-16'));
  ok('JOLTS 2026-12-01 10:00 ET', RELEASES.some(e => e.key === 'JOLTS' && e.day === '2026-12-01' && e.time === '10:00'));
  ok('UMich nihai 2026-11-20 doğrulandı', RELEASES.some(e => e.key === 'UMICH' && e.day === '2026-11-20' && e.verified));
  ok('blokaj kümesi FOMC/CPI/NFP', BLOCKING_KEYS.size === 3 && ['FOMC', 'CPI', 'NFP'].every(k => BLOCKING_KEYS.has(k)));
  ok('FOMC 2026-12-09 hâlâ MACRO_CALENDAR\'da', MACRO_CALENDAR.some(s => s.kind === 'FOMC' && s.dates.includes('2026-12-09')));
  ok('eventsOn(2026-12-09) FOMC içerir (yüksek önem)', eventsOn('2026-12-09').some(e => e.key === 'FOMC' && e.tier === 'high'));
  const un = RELEASES.filter(e => !e.verified).length;
  ok('doğrulanmamış tarihler işaretli (en az bir)', un > 0, String(un));
}

// 5) Gece kapısı: PPI günü blok DEĞİL; FOMC/CPI/NFP blok olmaya devam eder
{
  const T: MacroSeries[] = MACRO_CALENDAR;
  ok('13 Kas (PPI) gece kapısını engellemez', calendarCheck('2026-11-13', '2026-11-16', { kind: 'etf' }, T).ok);
  ok('9 Ara FOMC + 10 Ara CPI hâlâ engel', !calendarCheck('2026-12-09', '2026-12-10', { kind: 'etf' }, T).ok);
  const pos: OpenPosition = {
    id: 'p', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: '2026-11-18', dte: 2, strike: 100, contracts: 1, fill: 1, costBasis: 100,
    openComm: 0, stopPrem0: 1 / 3, stopPrem: 1 / 3, targetPrem: 3, rPrice: 2 / 3, rDollars: 100, targetR: 3, openedAt: 0, day: '2026-11-13',
    mode: 'AGRESIF', kademe: 0.5, overnight: false, maxR: 0, warned: false,
  };
  const d = overnightDecision({ pos, day: '2026-11-13', S: 100, ivAtm: 0.2, calendar: { ok: true, reasons: [] }, strongTriggerLast30: false, regimeAligned: true, pricer: () => 0.9 });
  ok('PPI günü gece: taşınır (blokaj yok)', d.carry, JSON.stringify(d.reasons));
  ok('PPI günü gece: uyarı listesinde PPI', d.warnings.some(w => w.includes('PPI')), JSON.stringify(d.warnings));
}

// 6) Sonuç kartı satırları (ET şimdiki an → İst)
{
  const before = cardCalendarLines(etMs('2026-11-13', '08:00'));   // PPI henüz yok
  ok('kart: bugün PPI 16:30 İst (açıklanmadı)', before.includes('⚠️ bugün PPI 16:30 İst'), JSON.stringify(before));
  const after = cardCalendarLines(etMs('2026-11-13', '09:00'));   // 17:00 İst
  ok('kart: 17:00 İst\'te PPI açıklandı', after.some(l => l === '⚠️ bugün PPI 16:30 İst · açıklandı'), JSON.stringify(after));
  const eve = cardCalendarLines(etMs('2026-11-12', '10:00'));
  ok('kart: yarın PPI satırı', eve.some(l => l.startsWith('⚠️ yarın PPI 16:30 İst')), JSON.stringify(eve));
  ok('kart: olay yoksa boş', cardCalendarLines(etMs('2026-11-16', '10:00')).filter(l => l.includes('PPI')).length === 0);
}

// 7) Rapor metni (17:00 İst önceki piyasa öncesi): PPI açıklandı, FOMC/yarın vs.
{
  const day = '2026-11-13', next = '2026-11-16';
  const rep = buildReport({
    kind: 'premarket', day, nowMs: etMs(day, '09:00'), watch: [], asia: [], europe: [], futures: [], preMarket: [], moves: [], walls: [],
    flow: [], news: [], newsOk: false, macro: { today: eventsOn(day), tomorrow: eventsOn(next) }, earnings: null, sma: [], failures: [],
  });
  ok('rapor 17:00: takvimde PPI açıklandı', rep.body.includes('PPI (üretici fiyatları) (08:30 ET · 16:30 İst) — açıklandı'), rep.body.split('\n').filter(l => l.includes('PPI')).join(' | '));
  ok('rapor: "önemli makro veri yok" yazmıyor', !rep.body.includes('Bugün önemli makro veri yok'));
}

// 7b) Gün içi ve gün sonu raporları: bugünkü veri satırı (açıklandı / bekleniyor)
{
  const day = '2026-11-13';
  const base = { day, watch: [], asia: [], europe: [], futures: [], preMarket: [], walls: [], flow: [], news: [], newsOk: false, earnings: null, sma: [], failures: [] };
  const i1 = buildReport({ ...base, kind: 'intra1', nowMs: etMs(day, '10:00'), moves: [], macro: { today: eventsOn(day), tomorrow: [] } });
  ok('açılış+30: bugünkü önemli veriler bölümü + PPI açıklandı', i1.body.includes('Bugünkü önemli veriler') && i1.body.includes('PPI (üretici fiyatları) (08:30 ET · 16:30 İst) — açıklandı'));
  const i0 = buildReport({ ...base, kind: 'intra1', nowMs: etMs(day, '08:00'), moves: [], macro: { today: eventsOn(day), tomorrow: [] } });
  ok('açılış+30 (08:00 İst öncesi): PPI bekleniyor', i0.body.includes('— bekleniyor'), i0.body.split('\n').filter(l => l.includes('PPI')).join(' | '));
  const eod = buildReport({ ...base, kind: 'eod', nowMs: etMs(day, '17:00'), moves: [], macro: { today: eventsOn(day), tomorrow: eventsOn('2026-11-16') } });
  ok('gün sonu: bugünkü veriler + (16 Kas) yarın boş', eod.body.includes('Bugünkü önemli veriler') && eod.body.includes('Yarın önemli makro veri yok'));
  ok('gün sonu push: yarın veri yok metni', eod.pushBody.includes('yarın önemli veri yok'), eod.pushBody);
}

// 8) Başvuru ve ISM saatleri (uyarı metni)
ok('ISM imalat 10:00 ET (listede)', RELEASES.some(e => e.key === 'ISM_MFG' && e.time === '10:00'));

console.log(fail ? `\n${fail} test başarısız` : '\nYayın takvimi testleri geçti');
if (fail) process.exit(1);
