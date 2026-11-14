/* Bilanço takvimi (saf): doğrulama, EPS sürprizi, piyasa değeri filtresi, yeni gerçek tespiti, ızgara, grafik verisi. */
import {
  checkRange, parseFinnhubCalendar, surprisePct, capUsdFromProfile, passesCapFilter, newActualsOf, parseFinnhubHistory,
  normalizeSymbols, staleDays, windowsOf, MIN_MARKET_CAP_USD, type EarningsItem,
} from '../src/lib/earnings/model.ts';
import { groupByTiming, countsByDay, monthGrid, monthSpan, monthFetchSpan, shiftMonth, weekTitle, weekOf, earnActualText, fmtEps, fmtSurprise, fmtCap } from '../src/lib/earnings/calendar.ts';
import { RangeCache } from '../src/lib/earnings/rangeCache.ts';
import { flowPremByDay, impliedMove } from '../src/lib/earnings/charts.ts';
import type { OptQuote } from '../src/lib/market/types.ts';
import type { FlowEvent } from '../src/lib/flow/model.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

// Aralık doğrulama (bugün 2026-11-13)
const r1 = checkRange(null, null, '2026-11-13');
ok('aralık: varsayılan bugün..+6 (7 gün)', 'from' in r1 && r1.from === '2026-11-13' && r1.to === '2026-11-19', JSON.stringify(r1));
ok('aralık: 62 gün kabul', 'from' in checkRange('2026-11-01', '2027-01-01', '2026-11-13'));
ok('aralık: 63 gün red', 'error' in checkRange('2026-11-01', '2027-01-02', '2026-11-13'));
ok('windowsOf: 62 gün → 31+31', JSON.stringify(windowsOf('2026-10-20', '2026-12-20')) === JSON.stringify([{ from: '2026-10-20', to: '2026-11-19' }, { from: '2026-11-20', to: '2026-12-20' }]));
ok('windowsOf: kısa aralık tek parça', windowsOf('2026-11-01', '2026-11-03').length === 1 && windowsOf('2026-11-03', '2026-11-01').length === 0);
ok('aralık: ters sıra red', 'error' in checkRange('2026-11-10', '2026-11-09', '2026-11-13'));
ok('aralık: bozuk tarih red', 'error' in checkRange('2026-13-01', null, '2026-11-13') && 'error' in checkRange('abc', null, '2026-11-13'));

// Sürpriz %
ok('sürpriz: (2,5−2)/2 = %25', surprisePct(2, 2.5) === 25);
ok('sürpriz: negatif beklenti mutlak paydayla', surprisePct(-1, -0.5) === 50, String(surprisePct(-1, -0.5)));
ok('sürpriz: beklenti 0 veya gerçek yok → null', surprisePct(0, 1) === null && surprisePct(1, null) === null && surprisePct(null, null) === null);
ok('sürpriz: iki ondalık yuvarlama', surprisePct(3, 3.1) === 3.33, String(surprisePct(3, 3.1)));

// Takvim ayrıştırma
const cal = parseFinnhubCalendar({ earningsCalendar: [
  { date: '2026-11-13', symbol: 'aapl', hour: 'bmo', epsEstimate: 1.5, epsActual: 1.65, revenueEstimate: 1e9, revenueActual: 1.1e9, quarter: 4, year: 2026 },
  { date: '2026-11-13', symbol: 'AAPL', hour: 'bmo', epsEstimate: 9, epsActual: 9 },                       // yinelenen → elenir
  { date: '2026-11-13', symbol: 'bad symbol!', hour: 'amc' },                                              // geçersiz sembol
  { date: '2026-12-01', symbol: 'OUT', hour: 'amc' },                                                       // aralık dışı
  { date: '2026-11-14', symbol: 'CRM', hour: 'amc', epsEstimate: 2, epsActual: null, quarter: 9, year: 2026 },
  { date: '2026-11-14', symbol: 'XYZ', hour: 'weird', epsEstimate: 'x' },                                   // bilinmeyen saat → '', sayı → null
] }, '2026-11-13', '2026-11-14');
ok('takvim: geçersiz/yinelenen/aralık dışı elenir', cal.length === 3, cal.map(x => x.symbol).join(','));
ok('takvim: sembol büyük harfe, surprise hesaplı', cal[0].symbol === 'AAPL' && cal[0].surprisePct === 10, JSON.stringify(cal[0]));
ok('takvim: bilinmeyen saat ve bozuk sayı', cal[2].hour === '' && cal[2].epsEstimate === null && cal[2].marketCapUsd === null);
ok('takvim: bozuk yanıt → boş', parseFinnhubCalendar({ foo: 1 }, '2026-11-13', '2026-11-14').length === 0);

// Piyasa değeri
ok('profil: milyon USD → USD', capUsdFromProfile({ marketCapitalization: 2500 }) === 2.5e9);
ok('profil: eksik / sıfır → null', capUsdFromProfile({}) === null && capUsdFromProfile({ marketCapitalization: 0 }) === null);
const base = { symbol: 'X', marketCapUsd: 3e9 } as Pick<EarningsItem, 'symbol' | 'marketCapUsd'>;
ok('filtre: ≥ 2 mlr geçer', passesCapFilter(base, new Set()));
ok('filtre: 1,99 mlr gizlenir', !passesCapFilter({ symbol: 'X', marketCapUsd: MIN_MARKET_CAP_USD - 1 }, new Set()));
ok('filtre: bilinmeyen değer gizlenir', !passesCapFilter({ symbol: 'X', marketCapUsd: null }, new Set()));
ok('filtre: izleme/favori her zaman geçer', passesCapFilter({ symbol: 'TINY', marketCapUsd: null }, new Set(['TINY'])));

// Yeni gerçek tespiti
const items: EarningsItem[] = [
  { ...cal[1], symbol: 'NEW', date: '2026-11-13', epsActual: 1 } as EarningsItem,        // önce kayıtlı ve boştu → yeni
  { ...cal[1], symbol: 'OLD', date: '2026-11-13', epsActual: 1 } as EarningsItem,        // önce zaten doluydu → hayır
  { ...cal[1], symbol: 'UNK', date: '2026-11-13', epsActual: 1 } as EarningsItem,        // hiç görülmemiş → hayır
  { ...cal[1], symbol: 'STILL', date: '2026-11-13', epsActual: null } as EarningsItem,   // hâlâ boş → hayır
];
const prev = new Map<string, boolean>([['2026-11-13|NEW', false], ['2026-11-13|OLD', true], ['2026-11-13|STILL', false]]);
const fresh = newActualsOf(prev, items).map(x => x.symbol);
ok('yeni gerçek: yalnız boştan dolana geçen', fresh.join(',') === 'NEW', fresh.join(','));

// Tekil sembol listesi
ok('semboller: büyük harf, tekil, geçersiz elenir', normalizeSymbols('aapl, msft,,AAPL,bad!, nvda').join(',') === 'AAPL,MSFT,NVDA');
ok('semboller: dizi girdisi ve sınır', normalizeSymbols(['a', 'b', 'c'], 2).join(',') === 'A,B');

// Geçmiş çeyrekler
const hist = parseFinnhubHistory([
  { actual: 1.2, estimate: 1, period: '2026-06-30', quarter: 2, year: 2026 },
  { actual: 0.9, estimate: 1, period: '2026-03-31', quarter: 1, year: 2026 },
  { actual: 1, estimate: 0, period: '2025-12-31', quarter: 4, year: 2025 },
  { actual: 1, estimate: 1, period: 'bozuk' },
], 'NVDA');
ok('geçmiş: eskiden yeniye, bozuk dönem elenir', hist.items.map(x => x.period).join(',') === '2025-12-31,2026-03-31,2026-06-30', JSON.stringify(hist.items.map(x => x.period)));
ok('geçmiş: sürpriz hesaplı, beklenti 0 → null', hist.items[1].surprisePct === -10 && hist.items[0].surprisePct === null);

// Önbellek politikası
const now = Date.parse('2026-11-13T15:00:00Z');                      // Cuma 10:00 ET (seans içi)
const fetched = new Map<string, number>([['2026-11-13', now - 3600000], ['2026-11-12', now - 3600000 * 30]]);
const stale = staleDays(fetched, '2026-11-12', '2026-11-14', now);
ok('politika: 1 saat önce çekilen bugün yenilenmez (08:00 ET kontrol noktası sonrası)', !stale.includes('2026-11-13'), stale.join(','));
ok('politika: çekilmemiş gün yenilenir', stale.includes('2026-11-14'), stale.join(','));

// Takvim gösterimi
const g = groupByTiming(cal);
ok('gruplama: bmo öncesi, amc sonrası, diğer belirtilmedi', g.pre.length === 1 && g.post.length === 1 && g.unknown.length === 1);
const cnt = countsByDay(cal);
ok('gün sayacı', cnt.get('2026-11-13')?.total === 1 && cnt.get('2026-11-14')?.post === 1 && cnt.get('2026-11-14')?.total === 2, JSON.stringify([...cnt]));
const grid = monthGrid(2026, 11);
ok('ay ızgarası: 1 Kas 2026 Pazar → ilk satırda 6 boş', grid[0][6] === '2026-11-01' && grid[0][0] === null && grid[0].slice(0, 6).every(x => x === null));
ok('ay ızgarası: 30 gün, satırlar 7 hücre', grid.flat().filter(Boolean).length === 30 && grid.every(r => r.length === 7));
ok('ay aralığı 1–30 Kas', JSON.stringify(monthSpan(2026, 11)) === '{"from":"2026-11-01","to":"2026-11-30"}');
ok('hafta: 13 Kas içeren pazartesi–pazar', weekOf('2026-11-13').join(',') === '2026-11-09,2026-11-10,2026-11-11,2026-11-12,2026-11-13,2026-11-14,2026-11-15');

// Biçim
ok('biçim: EPS / sürpriz / piyasa değeri', fmtEps(-0.5) === '−$0,50' && fmtSurprise(4.25) === '+4,3%' && fmtSurprise(null) === null && fmtCap(2.4e9) === '$2,4 mlr');
const at = earnActualText({ symbol: 'AAPL', epsActual: 1.65, epsEstimate: 1.5, surprisePct: 10 });
ok('bildirim metni', at.title === 'Bilanço açıklandı · AAPL' && at.body === 'EPS $1,65 · beklenti $1,50 · sürpriz +10,0%', JSON.stringify(at));

// Grafik verisi
const ev = (day: string, side: 'call' | 'put', prem: number, ticker = 'NVDA') => ({ day, side, prem, ticker } as FlowEvent);
const prem = flowPremByDay([ev('2026-11-12', 'call', 100), ev('2026-11-12', 'put', 40), ev('2026-11-13', 'call', 5), ev('2026-11-13', 'call', 5, 'MU')], 'NVDA');
ok('akış: gün bazında call/put, eskiden yeniye', prem.length === 2 && prem[0].call === 100 && prem[0].put === 40 && prem[1].call === 5, JSON.stringify(prem));
const q = (strike: number, bid: number, ask: number): OptQuote => ({ type: 'call', strike, bid, ask, last: 0, volume: 0, oi: 0, iv: 0.3 } as OptQuote);
const im = impliedMove({ calls: [q(100, 3, 3.2), q(105, 1, 1.2)], puts: [{ ...q(100, 2.8, 3), type: 'put' } as OptQuote, { ...q(105, 2, 2.2), type: 'put' } as OptQuote] }, 101);
ok('beklenen hareket: en yakın ATM straddle (100: 3,1 + 2,9 = 6,0)', im != null && im.strike === 100 && Math.abs(im.straddle - 6) < 1e-9 && Math.abs(im.pct - 6 / 101 * 100) < 1e-9, JSON.stringify(im));
ok('beklenen hareket: iki taraf da yoksa null', impliedMove({ calls: [q(100, 0, 0)], puts: [] }, 100) === null);

console.log(fail ? `\n${fail} BİLANÇO TESTİ BAŞARISIZ` : '\nBilanço testleri geçti');
process.exit(fail ? 1 : 0);

// Ay / hafta gezinme ve cihaz içi aralık önbelleği
ok('ay istek aralığı: ay ± 7 gün (Kas 2026)', JSON.stringify(monthFetchSpan(2026, 11)) === '{"from":"2026-10-25","to":"2026-12-07"}', JSON.stringify(monthFetchSpan(2026, 11)));
ok('ay istek aralığı sunucu sınırının (62 gün) içinde', checkRange(monthFetchSpan(2026, 2).from, monthFetchSpan(2026, 2).to, '2026-11-13') && 'from' in checkRange(monthFetchSpan(2026, 2).from, monthFetchSpan(2026, 2).to, '2026-11-13'));
ok('ay kaydırma: Ara → Oca (yıl geçişi)', JSON.stringify(shiftMonth(2026, 12, 1)) === '{"y":2027,"m":1}' && JSON.stringify(shiftMonth(2026, 1, -1)) === '{"y":2025,"m":12}');
ok('ay kaydırma: +2 ay', JSON.stringify(shiftMonth(2026, 11, 2)) === '{"y":2027,"m":1}');
ok('hafta başlığı: aynı ay', weekTitle('2026-11-09', '2026-11-15') === '9–15 Kas', weekTitle('2026-11-09', '2026-11-15'));
ok('hafta başlığı: iki ay arası', weekTitle('2026-10-26', '2026-11-01').includes('Eki') && weekTitle('2026-10-26', '2026-11-01').includes('Kas'));
const rc = new RangeCache<string>(1000, 2);
rc.set('a', 'A', 0);
ok('önbellek: TTL içinde döner', rc.get('a', 999) === 'A');
ok('önbellek: TTL dolunca düşer', rc.get('a', 1000) === undefined);
rc.set('b', 'B', 0); rc.set('c', 'C', 0);
ok('önbellek: en çok 2 kayıt (en eskisi atılır)', rc.size === 2 && rc.get('b', 1) === undefined && rc.get('c', 1) === 'C');
