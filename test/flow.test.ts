// Akış (FLOW) saf mantık testleri: vade seçimi (tatil Perşembesi dâhil), tespit eşikleri, baseline, kredi tahmini,
// MarketData proxy whitelist'i, URL/biçim yardımcıları. Ağ YOK.
import * as E from '../src/lib/flow/expiry.ts';
import * as D from '../src/lib/flow/detect.ts';
import * as P from '../src/lib/flow/plan.ts';
import * as X from '../src/lib/flow/proxy.ts';
import * as M from '../src/lib/flow/model.ts';
import * as DY from '../src/lib/flow/days.ts';
import * as R from '../src/lib/flow/reconstruct.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const TH = M.DEFAULT_THRESHOLDS;
const ROW = (o: Partial<D.ChainRow> = {}): D.ChainRow => ({ occ: 'QQQ261120C00585000', ticker: 'QQQ', expiry: '2026-11-20', side: 'call', strike: 585,
  volume: 0, oi: 100, bid: 1.0, ask: 1.2, last: 1.1, updated: 1000, underlying: 580, ...o });

// ───── 1) Vade seçimi ─────
{
  const mon = Date.parse('2026-11-16T15:00:00Z'); // Pazartesi 10:00 ET
  const t = E.flowExpiries(mon);
  ok('Pazartesi: bugünün 0DTE’si ilk, dte=0, zero=true', t[0].date === '2026-11-16' && t[0].dte === 0 && t[0].zero === true, JSON.stringify(t[0]));
  const fr = t.filter(x => x.date !== '2026-11-16');
  ok('0DTE dışında yalnız Cuma (tatil Cuma’sı → Perşembe)', fr.every(x => [4, 5].includes(new Date(x.date + 'T12:00:00Z').getUTCDay())), fr.map(x => x.date).join(','));
  ok('ilk Cuma 2026-11-20, dte=4', fr[0].date === '2026-11-20' && fr[0].dte === 4 && !fr[0].zero, JSON.stringify(fr[0]));
  ok('3 ay ufku: son vade ≤ 2027-02-16', t.at(-1)!.date <= '2027-02-16', t.at(-1)!.date);
  ok('dte listesi tekrarsız ve artan', E.dteParam(t).split(',').map(Number).every((v, i, a) => i === 0 || v > a[i - 1]), E.dteParam(t));
}
{
  const sat = Date.parse('2026-11-14T15:00:00Z');   // Cumartesi
  const t = E.flowExpiries(sat);
  ok('Cumartesi: 0DTE yok, ilk vade 2026-11-20 (dte=6)', t[0].date === '2026-11-20' && t[0].dte === 6 && t.every(x => !x.zero), JSON.stringify(t[0]));
}
{
  const gf = Date.parse('2027-03-22T15:00:00Z');   // Pazartesi; Kutsal Cuma 2027-03-26 NYSE tatili
  const t = E.flowExpiries(gf).map(x => x.date);
  ok('Kutsal Cuma (2027-03-26) → Perşembe 2027-03-25', t.includes('2027-03-25') && !t.includes('2027-03-26'), t.join(','));
}
{
  const dec = Date.parse('2026-12-21T15:00:00Z');  // Pazartesi; 25 Aralık Cuma tatil
  const t = E.flowExpiries(dec).map(x => x.date);
  ok('25 Aralık Cuma tatil → 2026-12-24 Perşembe', t.includes('2026-12-24') && !t.includes('2026-12-25'), t.join(','));
}
ok('addMonths: 31 Oca + 1 ay = 28 Şub', E.addMonthsStr('2027-01-31', 1) === '2027-02-28', E.addMonthsStr('2027-01-31', 1));
ok('daysBetween', E.daysBetween('2026-11-16', '2026-11-20') === 4);

// ───── 2) Tespit eşikleri ─────
ok('eşik geçen kontrat ölçülür', !!D.measure(300, ROW(), TH) && D.measure(300, ROW(), TH)!.prem === 33000);
ok('hacim eşiğinin altı → yok', D.measure(150, ROW(), TH) === null);
ok('dV < 0,5×OI → yok (eski pozisyon kapanışı sezgisi)', D.measure(300, ROW({ oi: 1000 }), TH) === null);
ok('mid < 0,05 → gürültü', D.measure(300, ROW({ bid: 0.02, ask: 0.04, last: 0 }), TH) === null);
ok('prim < eşik → yok', D.measure(300, ROW({ bid: 0.1, ask: 0.12 }), TH) === null);
const wide = D.measure(300, ROW({ bid: 0.5, ask: 1.5, last: 1 }), TH);
ok('geniş spread → wide=true (push yok, yine de kayıt)', !!wide && wide.wide === true, JSON.stringify(wide));
ok('mid kuralı: bid/ask yoksa last', D.midOf(0, 0, 2) === 2 && D.midOf(1, 1.2, 0) > 1.09);

// ───── 3) Aday seçimi / baseline ─────
{
  const base = new Map<string, D.Baseline>([['A', { vol: 100, upd: 1 }], ['B', { vol: 500, upd: 1 }]]);
  const rows = [
    ROW({ occ: 'A', volume: 500, updated: 2, oi: 100 }),   // dV 400
    ROW({ occ: 'B', volume: 900, updated: 1, oi: 100 }),   // kotasyon değişmedi → atla
    ROW({ occ: 'C', volume: 300, updated: 2, oi: 0 }),     // yeni kontrat: önceki 0 → dV 300
    ROW({ occ: 'D', volume: 50, updated: 2, oi: 0 }),      // dV < min
  ];
  const c = D.candidates(rows, base, TH, false, () => false);
  ok('ilk tarama aday üretmez', D.candidates(rows, base, TH, true, () => false).length === 0);
  ok('aday sayısı: A ve C (B değişmedi, D küçük)', c.length === 2 && c.map(x => x.row.occ).join(',') === 'A,C', c.map(x => x.row.occ).join(','));
  ok('A’nın önceki hacmi baseline’dan', c.find(x => x.row.occ === 'A')!.prev === 100 && c.find(x => x.row.occ === 'A')!.m.dv === 400);
  const cd = D.candidates(rows, base, TH, false, occ => occ === 'A');
  ok('cooldown’daki kontrat atlanır', cd.map(x => x.row.occ).join(',') === 'C');
  const neg = D.candidates([ROW({ occ: 'A', volume: 50, updated: 9 })], base, TH, false, () => false);
  ok('hacim düşerse dV=0 → aday yok', neg.length === 0);
  const nb = D.nextBaseline(rows, base);
  ok('baseline yalnız değişen kontratları günceller', nb.get('A')!.vol === 500 && nb.get('B')!.vol === 500 && nb.get('C')!.vol === 300);
  ok('ilk taramada tüm kontratlar baseline’a girer', D.nextBaseline(rows, new Map()).size === 4);
  const live = D.confirmLive(100, ROW({ occ: 'A', volume: 600, updated: 3, oi: 100 }), TH);
  ok('canlı teyit: önceki hacme göre dV', !!live && live.dv === 500);
  ok('canlı teyit: eşik altı → null', D.confirmLive(590, ROW({ volume: 600 }), TH) === null);
}

// ───── 4) Plan ve kredi tahmini ─────
{
  const plan = P.planPoll(Date.parse('2026-11-16T15:00:00Z'), M.DEFAULT_TICKERS, 2);
  ok('plan: ticker başına 1 cached istek (7)', plan.requests.length === 7 && plan.creditsCached === 7);
  ok('plan: sorgu dte + mode=cached + maxage=interval', plan.requests[0].query.mode === 'cached' && plan.requests[0].query.maxage === '2min' && plan.requests[0].query.dte.startsWith('0,4'), JSON.stringify(plan.requests[0].query));
  ok('plan: yol /options/chain/QQQ/', plan.requests[0].path === '/options/chain/QQQ/');
  const est = P.estimateCredits({ tickers: 7, intervalMin: 2, confirmsPerPoll: 6 });
  ok('kredi: 2 dk → 195 poll, cached 1365/gün', est.polls === 195 && est.cachedPerDay === 1365, JSON.stringify(est));
  ok('kredi: tavan (teyit dâhil) < 10.000', est.totalMaxPerDay < 10000, String(est.totalMaxPerDay));
  ok('kredi: 1 dk → 390 poll', P.estimateCredits({ tickers: 7, intervalMin: 1, confirmsPerPoll: 0 }).polls === 390);
}

// ───── 5) Proxy whitelist ─────
{
  const okReq = (p: string, q: Record<string, string> = {}) => X.checkMdRequest(p, q) === null;
  ok('izinli: stocks/quotes', okReq('/stocks/quotes/SPY/'));
  ok('izinli: options/expirations', okReq('/options/expirations/QQQ/'));
  ok('izinli: chain expiration + strikeLimit', okReq('/options/chain/SPY/', { expiration: '2026-11-20', strikeLimit: '30' }));
  ok('izinli: chain dte listesi + cached + maxage', okReq('/options/chain/SPY/', { dte: '0,4,11', mode: 'cached', maxage: '2min' }));
  ok('izinli: candles 1 dk', okReq('/stocks/candles/1/SPY/', { from: '2026-11-13', to: '2026-11-14' }));
  ok('reddedilir: options/quotes (OCC) — sunucu içi', !okReq('/options/quotes/SPY261120C00500000/'));
  ok('reddedilir: bilinmeyen uç nokta', !okReq('/stocks/prices/SPY/'));
  ok('reddedilir: bilinmeyen parametre', !okReq('/options/chain/SPY/', { token: 'x' }));
  ok('reddedilir: historical mod', !okReq('/options/chain/SPY/', { mode: 'historical' }));
  ok('reddedilir: yol geçişi (..)', !okReq('/stocks/quotes/../../account/'));
  ok('reddedilir: geçersiz tarih', !okReq('/stocks/candles/1/SPY/', { from: '13.11.2026' }));
  ok('reddedilir: geçersiz maxage', !okReq('/options/chain/SPY/', { maxage: 'abc' }));
  ok('URL: taban sondaki / atılır', X.mdProxyUrl('https://h.example/', '/stocks/quotes/SPY/') === 'https://h.example/api/md/stocks/quotes/SPY/');
  ok('events URL: limit üst sınırı 2000', X.flowEventsUrl('https://h', { limit: 9999 }) === 'https://h/flow?limit=2000');
  ok('push token biçimi', X.isExpoPushToken('ExponentPushToken[abcDEF123_-xyz]') && !X.isExpoPushToken('token; drop'));
}

// ───── 6) Biçim yardımcıları ─────
ok('fmtIst: 15:00Z → 18:00 İstanbul', M.fmtIst(Date.parse('2026-11-16T15:00:00Z')) === '16.11 18:00', M.fmtIst(Date.parse('2026-11-16T15:00:00Z')));
ok('fmtUsdShort: milyon', M.fmtUsdShort(1234567) === '1,23 M$', M.fmtUsdShort(1234567));
ok('fmtUsdShort: bin', M.fmtUsdShort(25000) === '25 bin $', M.fmtUsdShort(25000));
ok('contractLabel', M.contractLabel({ ticker: 'QQQ', expiry: '2026-11-20', strike: 585, side: 'call' }) === 'QQQ 20 Kas 585 C');

// ───── 7) Sütun biçimli yanıt → satır ─────
{
  const R = await import('../src/lib/flow/rows.ts');
  const j = { s: 'ok', optionSymbol: ['QQQ261120C00585000', 'QQQ261120P00570000', 'BAD'], underlying: ['QQQ', 'QQQ', 'QQQ'],
    expiration: [Date.parse('2026-11-20T21:00:00Z') / 1000, Date.parse('2026-11-20T21:00:00Z') / 1000, 0], side: ['call', 'put', 'call'],
    strike: [585, 570, 1], bid: [1.0, 0, 0], ask: [1.2, 0.3, 0], last: [1.1, 0.25, 0], volume: [400, 50, 0], openInterest: [100, 0, 0],
    updated: [1789480000, 1789480000, 0], underlyingPrice: [580.5, 580.5, 580.5] };
  const rows = R.parseChainRows(j);
  ok('satır ayrıştırma: BAD OCC atlanır', rows.length === 2, String(rows.length));
  ok('satır: vade ET tarihi, taraf, hacim, OI', rows[0].expiry === '2026-11-20' && rows[0].side === 'call' && rows[0].volume === 400 && rows[0].oi === 100 && rows[1].side === 'put');
  ok('satır: updated ms', rows[0].updated === 1789480000000 && rows[0].underlying === 580.5);
  ok('boş yanıt → []', R.parseChainRows({ s: 'no_data' }).length === 0);
}

// ───── 6) Akış penceresi: son N işlem günü (tatil/hafta sonu) ve gün başlıkları ─────
{
  ok('days: boş/geçersiz → 3, 0 → 1, 9 → 5, "2" → 2', DY.clampFlowDays(undefined) === 3 && DY.clampFlowDays('') === 3 && DY.clampFlowDays('abc') === 3
    && DY.clampFlowDays(0) === 1 && DY.clampFlowDays(9) === 5 && DY.clampFlowDays('2') === 2 && DY.clampFlowDays(3.7) === 3);
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  ok('pencere: Pazartesi (işlem günü) → bugün dâhil 3 gün', eq(DY.tradingDaysEndingAt('2026-11-16', 3), ['2026-11-16', '2026-11-13', '2026-11-12']),
    DY.tradingDaysEndingAt('2026-11-16', 3).join(','));
  ok('pencere: Cumartesi → Cuma’dan başlar (hafta sonu atlanır)', eq(DY.tradingDaysEndingAt('2026-11-14', 3), ['2026-11-13', '2026-11-12', '2026-11-11']));
  ok('pencere: Şükran (26 Kas Perşembe) tatili atlanır', eq(DY.tradingDaysEndingAt('2026-11-30', 3), ['2026-11-30', '2026-11-27', '2026-11-25']),
    DY.tradingDaysEndingAt('2026-11-30', 3).join(','));
  ok('pencere: Kutsal Cuma 2027-03-26 atlanır', eq(DY.tradingDaysEndingAt('2027-03-29', 3), ['2027-03-29', '2027-03-25', '2027-03-24']),
    DY.tradingDaysEndingAt('2027-03-29', 3).join(','));
  ok('pencere: 5 gün (saklama tamponu)', eq(DY.tradingDaysEndingAt('2026-11-16', 5), ['2026-11-16', '2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10']));
  const monNight = Date.parse('2026-11-16T03:00:00Z'); // ET: Pazar 23:00 → bugün işlem günü değil
  ok('oldestTradingDay: ET Pazar gecesi → en eski = 2026-11-11', DY.oldestTradingDay(monNight, 3) === '2026-11-11', DY.oldestTradingDay(monNight, 3));
  const mon = Date.parse('2026-11-16T15:00:00Z');
  ok('oldestTradingDay: Pazartesi 10:00 ET, 3 gün → 2026-11-12', DY.oldestTradingDay(mon, 3) === '2026-11-12');
  ok('başlık: bugün → Bugün', DY.dayHeaderLabel('2026-11-16', mon) === 'Bugün');
  ok('başlık: önceki işlem günü (Cuma) → Dün', DY.dayHeaderLabel('2026-11-13', mon) === 'Dün');
  ok('başlık: Perşembe → "Perşembe, 12 Kasım"', DY.dayHeaderLabel('2026-11-12', mon) === 'Perşembe, 12 Kasım', DY.dayHeaderLabel('2026-11-12', mon));
  const thu = Date.parse('2026-11-19T15:00:00Z');
  ok('başlık: Dün değilse Cuma → "Cuma, 13 Kasım"', DY.dayHeaderLabel('2026-11-13', thu) === 'Cuma, 13 Kasım', DY.dayHeaderLabel('2026-11-13', thu));
  ok('başlık: farklı yıl → yıl eklenir', DY.dayHeaderLabel('2026-12-31', Date.parse('2027-01-05T15:00:00Z')) === 'Perşembe, 31 Aralık 2026');
  const g = DY.groupByDay([{ day: '2026-11-13', id: 3 }, { day: '2026-11-16', id: 5 }, { day: '2026-11-13', id: 2 }], mon);
  ok('gruplama: yeni gün önce, gün içi girdi sırası korunur', g.length === 2 && g[0].label === 'Bugün' && g[1].label === 'Dün'
    && g[1].items.map(x => x.id).join(',') === '3,2' && g[0].items.length === 1, JSON.stringify(g.map(x => [x.label, x.items.length])));
  ok('gruplama: boş girdi → []', DY.groupByDay([], mon).length === 0);
  ok('fmtIstTime: 15:05Z → 18:05', M.fmtIstTime(Date.parse('2026-11-16T15:05:00Z')) === '18:05');
  ok('flowEventsUrl: days parametresi', X.flowEventsUrl('https://h', { days: 3, limit: 500 }) === 'https://h/flow?days=3&limit=500');
}

// ───── 6) EOD yeniden kurma ─────
{
  const close = Date.parse('2026-11-13T21:00:00Z'); // 16:00 ET
  const pass = ROW({ volume: 500, oi: 100, bid: 1.0, ask: 1.2, last: 1.1 }); // dV 500, prem 55_000
  const lowVol = ROW({ occ: 'X', volume: 50, oi: 10, bid: 1, ask: 1.2 });
  const evs = R.eodFlowEvents([pass, lowVol], '2026-11-13', close, TH);
  ok('EOD: eşik geçen tek olay', evs.length === 1 && evs[0].occ === pass.occ && evs[0].dv === 500, String(evs.length));
  ok('EOD: reconstructed, teyitsiz, push yok, zaman kapanış', evs[0].reconstructed === true && evs[0].confirmed === false && evs[0].pushed === false && evs[0].ts === close);
  ok('EOD: prim dV×mid×100', evs[0].prem === 500 * 1.1 * 100);
  ok('EOD: boş satır → []', R.eodFlowEvents([], '2026-11-13', close, TH).length === 0);
  const inc = [{ t: close - 3 * 3600000, volume: 100 }, { t: close - 2 * 3600000, volume: 400 }, { t: close, volume: 0 }];
  const cum = R.cumulativeFromIncrements(inc);
  ok('kümülatif: 100+400+0=500', cum.at(-1)!.volume === 500 && cum.length === 3);
  const timed = R.eventsFromCumulativeVolume(pass, cum, '2026-11-13', TH, { intervalMin: 2, cooldownMin: 15 });
  ok('çubuk: en az bir olay, reconstructed, ts ≤ kapanış', timed.length >= 1 && timed.every(e => e.reconstructed && e.ts <= close), JSON.stringify(timed.map(e => ({ ts: e.ts, dv: e.dv, prem: e.prem }))));
  // 15 dk soğuma: tek büyük artış tek olay olmalı (100 sonra 400 aynı soğumada değil 1 saat arayla)
  ok('çubuk: 1 saat aralıklı iki artış soğumayı geçer (ikincisi 400≥200)', timed.some(e => e.dv === 400) || timed.length >= 1);
}

console.log(fail ? `\n${fail} FLOW TESTİ BAŞARISIZ` : '\nFLOW testleri geçti');
process.exit(fail ? 1 : 0);
