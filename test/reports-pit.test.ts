// Nokta-zamanlı (point-in-time) rapor yeniden kurulumu: tamamlanmış bar kuralı, önceki gün kapanışı, gün sonu
// kapanış kapısı, Yahoo seri ayrıştırma, örnek etiketi, "veri alınamadı" dürüstlüğü. Ağ YOK.
import * as P from '../src/lib/reports/pit.ts';
import { parseYahooSeries } from '../src/lib/reports/sources.ts';
import { buildReport } from '../src/lib/reports/text.ts';
import { slotsFor } from '../src/lib/reports/schedule.ts';
import { exDivMs } from '../src/lib/usmarket.ts';
import type { ReportInput } from '../src/lib/reports/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const ms = (iso: string) => Date.parse(iso);
const MIN = 60000;

// ───── 1) Yerel tarih (borsa saat dilimi) ─────
ok('Tokyo 23:00 → aynı takvim günü', P.localDate(ms('2026-11-13T14:00:00Z'), 'Asia/Tokyo') === '2026-11-13');
ok('New York 09:00 → aynı gün', P.localDate(ms('2026-11-13T14:00:00Z'), P.NY_TZ) === '2026-11-13');
ok('New York 23:00 önceki gün', P.localDate(ms('2026-11-13T03:00:00Z'), P.NY_TZ) === '2026-11-12');

// ───── 2) Yahoo dönemi: period2 = rapor anı (sonrası istenmez) ─────
{
  const cut = ms('2026-11-13T14:00:00Z');
  const p = P.pitPeriods(cut, 3);
  ok('dönem: period2 = rapor anı (saniye)', p.period2 === cut / 1000, String(p.period2));
  ok('dönem: period1 = 3 gün önce', p.period2 - p.period1 === 3 * 86400, String(p.period2 - p.period1));
}

// ───── 3) Tamamlanmış bar: t + süre ≤ rapor anı ─────
{
  const cut = ms('2026-11-13T14:00:00Z');
  const bars = [
    { t: cut - 2 * MIN, o: 1, c: 10 },   // 13:58–13:59 tamam → girer
    { t: cut - MIN, o: 1, c: 11 },       // 13:59–14:00 tam kapanışta biter → girer
    { t: cut, o: 1, c: 99 },             // 14:00–14:01 henüz yok → GİRMEZ (look-ahead)
  ];
  const last = P.lastEndedBy(bars, MIN, cut);
  ok('son tamamlanmış bar: kapanış 11 (14:00 barı girmez)', last?.c === 11, JSON.stringify(last));
  ok('bar yoksa null', P.lastEndedBy([], MIN, cut) === null);
}

// ───── 4) Önceki gün kapanışı: referans günün kendi barı kullanılmaz ─────
{
  const daily = [
    { t: ms('2026-11-11T14:30:00Z'), o: null, c: 99 },
    { t: ms('2026-11-12T14:30:00Z'), o: null, c: 100 },
    { t: ms('2026-11-13T14:30:00Z'), o: null, c: 101 },   // rapor günü: prev'e girmez
    { t: ms('2026-11-16T14:30:00Z'), o: null, c: 110 },  // gelecek gün: hiç girmez
  ];
  ok('önceki kapanış (13 için) = 12 Kasım kapanışı 100', P.prevCloseBefore(daily, '2026-11-13', P.NY_TZ) === 100);
  ok('önceki kapanış (12 için) = 99', P.prevCloseBefore(daily, '2026-11-12', P.NY_TZ) === 99);
  ok('yoksa null', P.prevCloseBefore([], '2026-11-13', P.NY_TZ) === null);
}

// ───── 5) Gün sonu kapısı: günlük bar yalnız 16:00 ET kapanışı rapor anından önceyse ─────
{
  const daily = [
    { t: ms('2026-11-13T14:30:00Z'), o: null, c: 101 },
    { t: ms('2026-11-16T14:30:00Z'), o: null, c: 110 },
  ];
  const at2130 = ms('2026-11-13T21:30:00Z');   // 13 Kas 00:30 İst (gün sonu +30 dk)
  const done = P.dailyDoneBy(daily, at2130);
  ok('gün sonu (21:30Z): 13 Kasım kapanışı kullanılır', done.length === 1 && done[0].c === 101, JSON.stringify(done));
  ok('gün sonu öncesi (20:00Z): 13 Kasım kullanılmaz', P.dailyDoneBy(daily, ms('2026-11-13T20:00:00Z')).length === 0);
  ok('16 Kasım barı hiçbir zaman girmez', P.dailyDoneBy(daily, at2130).every(b => b.c !== 110));
}

// ───── 6) Rapor anındaki fiyat: yerel tarih = rapor günü şartı ─────
{
  const cut = ms('2026-11-13T14:00:00Z');
  const intra = [{ t: cut - 2 * MIN, o: 1, c: 50 }, { t: cut - MIN, o: 1, c: 51 }];
  ok('fiyat: rapor günü eşleşirse son kapanış', P.pitPrice(intra, MIN, cut, P.NY_TZ, '2026-11-13') === 51);
  ok('fiyat: tarih uymazsa null (önceki günün barı)', P.pitPrice(intra, MIN, cut, P.NY_TZ, '2026-11-16') === null);
}

// ───── 7) Açılış ve son fiyat (açılıştan beri) ─────
{
  const day = '2026-11-13';
  const open0 = exDivMs(day);
  const bars = [
    { t: open0 - 30 * MIN, o: 40, c: 40 },          // ön piyasa: açılış sayılmaz
    { t: open0, o: 100, c: 100.5 },
    { t: open0 + MIN, o: 100.5, c: 101 },
    { t: open0 + 2 * MIN, o: 101, c: 102 },         // 09:32–09:33 → cutoff 09:33'te biter → girer
    { t: open0 + 3 * MIN, o: 102, c: 999 },         // 09:33–09:34 → cutoff 09:33'ten sonra → GİRMEZ
  ];
  const cut = open0 + 3 * MIN;
  const r = P.openAndLast(bars, MIN, cut, open0);
  ok('açılış fiyatı = 09:30 barının açılışı (100)', r.open === 100, JSON.stringify(r));
  ok('son fiyat = 09:32 barının kapanışı (102), 09:33 barı değil', r.last === 102, JSON.stringify(r));
}

// ───── 8) Yahoo seri ayrıştırma ─────
{
  const j = { chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [9, 9, null], close: [10, null, 30] }] }, meta: { exchangeTimezoneName: 'Asia/Tokyo' } }] } };
  const q = parseYahooSeries(j);
  ok('seri: boş kapanışlı bar atlanır (2 bar)', q?.bars.length === 2, JSON.stringify(q));
  ok('seri: zaman saniye → ms', q?.bars[0].t === 1000 && q?.bars[1].t === 3000);
  ok('seri: açılış null olabilir', q?.bars[1].o === null && q?.bars[0].o === 9);
  ok('seri: saat dilimi meta’dan', q?.tz === 'Asia/Tokyo');
  ok('seri: tz yoksa New York', parseYahooSeries({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } })?.tz === P.NY_TZ);
  ok('seri: bozuk yanıt → null', parseYahooSeries({}) === null);
}

// ───── 9) Örnek etiketi: başlık öneki + gövde notu; girdi değişmez ─────
{
  const cut = ms('2026-11-13T15:00:00Z');   // 18:00 İst
  const rep = { kind: 'intra1' as const, day: '2026-11-13', ts: cut, title: 'Açılış +30 dk · 18:00 İst', body: 'GÖVDE', pushTitle: 'p', pushBody: 'b', sections: null as never };
  const ex = P.exampleReport(rep);
  ok('örnek: başlık "Örnek · " öneki', ex.title === 'Örnek · Açılış +30 dk · 18:00 İst', ex.title);
  ok('örnek: gövde notu ve özgün metin', ex.body.startsWith('ÖRNEK RAPOR') && ex.body.includes('18:00 İst') && ex.body.endsWith('GÖVDE'));
  ok('örnek: girdi değişmez', rep.title === 'Açılış +30 dk · 18:00 İst' && rep.body === 'GÖVDE');
}

// ───── 10) Akış kaydı yoksa: "veri alınamadı" (sahte "birikim yok" yazılmaz) ─────
{
  const slot = slotsFor('2026-11-13').find(s => s.kind === 'intra1')!;
  const base: ReportInput = {
    kind: 'intra1', day: '2026-11-13', nowMs: slot.atMs, watch: [], asia: [], europe: [], futures: [], preMarket: [], moves: [],
    walls: [], flow: [], news: [], newsOk: true, macro: { today: [], tomorrow: [] }, earnings: null, sma: [], failures: [],
  };
  const unknown = buildReport({ ...base, flowKnown: false }).body;
  const known = buildReport({ ...base, flowKnown: true }).body;
  const section = (b: string) => b.slice(b.indexOf('Opsiyon birikimi'), b.indexOf('Opsiyon birikimi') + 90);
  ok('akış yok: birikim bölümü "veri alınamadı"', section(unknown).includes('veri alınamadı') && !section(unknown).includes('Eşik üstü'), section(unknown));
  ok('akış var (boş): "Eşik üstü birikim yok"', section(known).includes('Eşik üstü birikim yok'), section(known));
}

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\nreports-pit testleri tamam');
