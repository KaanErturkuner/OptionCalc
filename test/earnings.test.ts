/* Bilanço takvimi (saf): USD ayrıştırma, takvim yanıtı, gruplama, tarih şeridi, zincir özeti. */
import { parseUsd, parseEarningsCalendar, groupByTiming, tradingStrip, summarizeChain } from '../src/lib/earnings/calendar.ts';
import type { OptQuote } from '../src/lib/market/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

ok('USD: "$2.50" → 2,5', parseUsd('$2.50') === 2.5);
ok('USD: "(0.12)" → −0,12', parseUsd('(0.12)') === -0.12);
ok('USD: "N/A" ve boş → null', parseUsd('N/A') === null && parseUsd('') === null && parseUsd(undefined) === null);

const json = { data: { rows: [
  { symbol: 'CRM', name: 'Salesforce', time: 'time-after-hours', epsForecast: '$2.50', noOfEsts: '30', lastYearEPS: '$2.40', lastYearRptDt: '11/30/2025', marketCap: '$250B' },
  { symbol: 'AMD', name: 'AMD', time: 'time-pre-market', epsForecast: '$0.90', noOfEsts: '40', lastYearEPS: '$0.85' },
  { symbol: 'bad symbol!', name: 'X', time: 'time-pre-market' },
  { symbol: 'ZZZ', name: 'Saat yok', time: 'time-not-supplied', epsForecast: 'N/A' },
] } };
const rows = parseEarningsCalendar(json);
ok('takvim: geçersiz sembol elenir', rows.length === 3, String(rows.length));
ok('takvim: saat kodu eşlenir', rows[0].timing === 'post' && rows[1].timing === 'pre' && rows[2].timing === 'unknown');
ok('takvim: beklenti ve analist sayısı', rows[0].epsForecast === 2.5 && rows[0].estimates === 30 && rows[0].lastYearEps === 2.4);
const g = groupByTiming(rows);
ok('gruplama: öncesi / sonrası / belirtilmemiş', g.pre.length === 1 && g.post.length === 1 && g.unknown.length === 1);
ok('parseEarningsCalendar: bozuk yanıt → boş', parseEarningsCalendar({ foo: 1 }).length === 0);

// 13 Kas 2026 Cuma (işlem günü) bugün; 14–15 Kas hafta sonu
const now = Date.parse('2026-11-13T15:00:00Z');
const strip = tradingStrip(now, 2, 3);
ok('şerit: 2 önceki + bugün + 3 sonraki işlem günü', strip.length === 6, JSON.stringify(strip));
ok('şerit: hafta sonu atlanır (16 Kas Pazartesi sonrası)', strip.includes('2026-11-13') && strip.includes('2026-11-16') && !strip.includes('2026-11-14'));

const call = (strike: number, oi: number, volume: number): OptQuote => ({ type: 'call', strike, bid: 1, ask: 1.2, last: 1.1, volume, oi, iv: 0.3 } as OptQuote);
const put = (strike: number, oi: number, volume: number): OptQuote => ({ type: 'put', strike, bid: 1, ask: 1.2, last: 1.1, volume, oi, iv: 0.3 } as OptQuote);
const s = summarizeChain('2026-11-20', [call(100, 500, 50), call(105, 900, 20), call(110, 10, 5), call(95, 0, 0)], [put(95, 800, 30)]);
ok('zincir özeti: OI ve hacim toplamı', s.callOi === 1410 && s.putOi === 800 && s.callVol === 75 && s.putVol === 30, JSON.stringify(s));
ok('zincir özeti: en yoğun çağrı OI sırasıyla, OI=0 hariç', s.topCalls[0].strike === 105 && s.topCalls.every(o => o.oi > 0));

console.log(fail ? `\n${fail} BİLANÇO TESTİ BAŞARISIZ` : '\nBilanço testleri geçti');
process.exit(fail ? 1 : 0);
