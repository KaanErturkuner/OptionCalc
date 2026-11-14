/* Bilanço takvimi sunucu önbelleği: piyasa değeri filtresi, favori bildirimi (yalnız boştan dolana, bir kez), geçmiş önbelleği.
 * Ağ YOK: sahte Finnhub kaynağı ve :memory: SQLite. */
import { Store } from './store.ts';
import { EarningsCache, type CalendarSource, type PushMsg } from './earnings.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

const TOKEN = 'ExponentPushToken[testdevice0000000000]';
const H = 3600000;

/** Sahte kaynak + önbellek. actual: FAV'ın epsActual'i dolu mu (test değiştirir). clock: ms (test ileri sarar). */
function setup() {
  const store = new Store(':memory:');
  const actual = new Set<string>();
  const sent: PushMsg[] = [];
  const clock = { t: Date.parse('2026-11-13T15:00:00Z') };   // Cuma 10:00 ET
  const src: CalendarSource = {
    async calendarEarnings() {
      return { earningsCalendar: [
        { date: '2026-11-13', symbol: 'BIG', hour: 'bmo', epsEstimate: 1, epsActual: null },
        { date: '2026-11-13', symbol: 'SMALL', hour: 'amc', epsEstimate: 1, epsActual: null },
        { date: '2026-11-14', symbol: 'NOCAP', hour: 'amc', epsEstimate: 1, epsActual: null },
        { date: '2026-11-13', symbol: 'FAV', hour: 'amc', epsEstimate: 2, epsActual: actual.has('FAV') ? 2.5 : null },
      ] };
    },
    async profile(sym: string) {
      const caps: Record<string, number> = { BIG: 5000, SMALL: 1000, FAV: 500 };
      if (sym in caps) return { marketCapitalization: caps[sym] };
      throw new Error('Finnhub HTTP 403');
    },
    async earningsHistory() { histCalls++; return [{ actual: 1.2, estimate: 1, period: '2026-06-30', quarter: 2, year: 2026 }]; },
  };
  let histCalls = 0;
  const cache = new EarningsCache({
    store, src, now: () => clock.t, log: () => {},
    notify: async msgs => { sent.push(...msgs); return msgs.length; },
  });
  return { store, cache, actual, sent, clock, histCalls: () => histCalls };
}
const flush = () => new Promise(r => setTimeout(r, 0));

async function main() {
  // 1) piyasa değeri filtresi
  {
    const s = setup();
    const r0 = await s.cache.range('2026-11-13', '2026-11-14');
    ok('piyasa değeri yokken liste gizli', r0.items.length === 0, String(r0.items.length));
    const filled = await s.cache.fillCaps('2026-11-13', '2026-11-14', 50);
    ok('piyasa değeri: 3 başarılı (NOCAP hatası null kaydedilir)', filled === 3, String(filled));
    const r1 = await s.cache.range('2026-11-13', '2026-11-14');
    ok('≥ 2 mlr geçer; küçük, bilinmeyen gizli', r1.items.map(x => x.symbol).join(',') === 'BIG', r1.items.map(x => x.symbol).join(','));
    const r2 = await s.cache.range('2026-11-13', '2026-11-14', ['SMALL', 'NOCAP']);
    ok('izleme listesindeki küçük/bilinmeyen geçer', r2.items.map(x => x.symbol).join(',') === 'BIG,SMALL,NOCAP', r2.items.map(x => x.symbol).join(','));
    ok('piyasa değeri satıra eklenir', r1.items[0].marketCapUsd === 5e9);
    s.store.close();
  }

  // 2) favori bildirimi: yalnız boş→dolu geçişinde, cihaz başına bir kez
  {
    const s = setup();
    s.cache.setFavs(TOKEN, ['FAV']);
    await s.cache.range('2026-11-13', '2026-11-14');                  // ilk çekim: FAV boş, önceden görülmemiş
    await flush();
    ok('ilk çekimde bildirim yok', s.sent.length === 0);

    s.actual.add('FAV'); s.clock.t += 25 * H;                          // sonuç açıklandı; önbellek 24 saatten eski
    await s.cache.range('2026-11-13', '2026-11-14');
    await flush();
    ok('favori EPS açıklanınca tek bildirim', s.sent.length === 1 && s.sent[0].to === TOKEN, JSON.stringify(s.sent.map(m => m.title)));
    ok('bildirim metni EPS ve sürpriz içerir', /EPS \$2,50 · beklenti \$2,00 · sürpriz \+25,0%/.test(s.sent[0]?.body ?? ''), s.sent[0]?.body);

    s.clock.t += 25 * H;                                               // tekrar çekim: artık dolu → yeni geçiş yok
    await s.cache.range('2026-11-13', '2026-11-14');
    await flush();
    ok('aynı sonuç tekrar bildirilmez', s.sent.length === 1, String(s.sent.length));
    s.store.close();
  }

  // 3) favori değilse bildirim yok
  {
    const s = setup();
    s.cache.setFavs(TOKEN, ['BIG']);
    await s.cache.range('2026-11-13', '2026-11-14');
    s.actual.add('FAV'); s.clock.t += 25 * H;
    await s.cache.range('2026-11-13', '2026-11-14');
    await flush();
    ok('favori olmayan sembol için bildirim yok', s.sent.length === 0);
    s.store.close();
  }

  // 4) geçmiş çeyrek önbelleği: 24 saat içinde Finnhub'a tekrar gidilmez
  {
    const s = setup();
    const a = await s.cache.history('NVDA');
    await s.cache.history('NVDA');
    ok('geçmiş: ikinci çağrı önbellekten', s.histCalls() === 1 && a.items.length === 1 && a.items[0].surprisePct === 20, `calls=${s.histCalls()}`);
    s.store.close();
  }

  // 5) favori kayıt: sayı döner; sınır yok iken kabul
  {
    const s = setup();
    ok('favori kaydı sayı döndürür', s.cache.setFavs(TOKEN, ['A', 'B']) === 2);
    s.store.close();
  }

  // 6) 62 günlük aralık: Finnhub takvim çağrıları 31 günlük parçalara bölünür; tick penceresi bugün−3 … bugün+60
  {
    const calls: string[] = [];
    const store = new Store(':memory:');
    const clock = { t: Date.parse('2026-11-13T15:00:00Z') };   // Cuma 10:00 ET
    const src: CalendarSource = {
      async calendarEarnings(f: string, t: string) { calls.push(`${f}..${t}`); return { earningsCalendar: [] }; },
      async profile() { throw new Error('Finnhub HTTP 403'); },
      async earningsHistory() { return []; },
    };
    const cache = new EarningsCache({ store, src, now: () => clock.t, log: () => {} });
    const r = await cache.range('2026-10-20', '2026-12-20');
    ok('62 gün: iki parça çağrısı', calls.length === 2 && calls[0] === '2026-10-20..2026-11-19' && calls[1] === '2026-11-20..2026-12-20', calls.join(' | '));
    ok('62 gün: yanıt aralığı doğru', r.from === '2026-10-20' && r.to === '2026-12-20');
    calls.length = 0;
    await cache.range('2026-10-20', '2026-12-20');
    ok('62 gün: ikinci istek önbellekten (Finnhub yok)', calls.length === 0, calls.join(' | '));
    const store2 = new Store(':memory:');
    const calls2: string[] = [];
    const cache2 = new EarningsCache({ store: store2, src: { ...src, async calendarEarnings(f: string, t: string) { calls2.push(`${f}..${t}`); return { earningsCalendar: [] }; } }, now: () => clock.t, log: () => {} });
    await cache2.tick();
    ok('tick: bugün−3 … bugün+60 (64 gün, 3 parça)', calls2.length === 3 && calls2[0] === '2026-11-10..2026-12-10' && calls2[1] === '2026-12-11..2027-01-10' && calls2[2] === '2027-01-11..2027-01-12', calls2.join(' | '));
    store2.close();
    store.close();
  }

  // 7) bir parça başarısız, aralığın her günü önbellekte değilse hata; hepsi önbellekteyse önbellek döner
  {
    let fail = false;
    const store = new Store(':memory:');
    const clock = { t: Date.parse('2026-11-13T15:00:00Z') };
    const src: CalendarSource = {
      async calendarEarnings() { if (fail) throw new Error('Finnhub HTTP 500'); return { earningsCalendar: [] }; },
      async profile() { throw new Error('Finnhub HTTP 403'); },
      async earningsHistory() { return []; },
    };
    const cache = new EarningsCache({ store, src, now: () => clock.t, log: () => {} });
    await cache.range('2026-11-01', '2026-11-30');                       // ilk parça tamam
    fail = true; clock.t += 25 * H;                                      // önbellek eski
    let threw = false;
    try { await cache.range('2026-11-01', '2026-12-31'); } catch { threw = true; }
    ok('eksik gün + parça hatası → hata', threw);
    store.close();
  }

  console.log(fail ? `\n${fail} BİLANÇO SUNUCU TESTİ BAŞARISIZ` : '\nBilanço sunucu testleri geçti');
  process.exit(fail ? 1 : 0);
}
void main();
