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

  console.log(fail ? `\n${fail} BİLANÇO SUNUCU TESTİ BAŞARISIZ` : '\nBilanço sunucu testleri geçti');
  process.exit(fail ? 1 : 0);
}
void main();
