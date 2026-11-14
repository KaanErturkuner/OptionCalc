// Akış (FLOW) saf mantık testleri: vade seçimi (tatil Perşembesi dâhil), tespit eşikleri, baseline, kredi tahmini,
// MarketData proxy whitelist'i, URL/biçim yardımcıları. Ağ YOK.
import * as E from '../src/lib/flow/expiry.ts';
import * as D from '../src/lib/flow/detect.ts';
import * as P from '../src/lib/flow/plan.ts';
import * as X from '../src/lib/flow/proxy.ts';
import * as M from '../src/lib/flow/model.ts';
import * as DY from '../src/lib/flow/days.ts';
import * as R from '../src/lib/flow/reconstruct.ts';
import * as FL from '../src/lib/flow/filter.ts';
import * as DI from '../src/lib/flow/distribution.ts';
import * as YO from '../src/lib/flow/yorum.ts';
import * as AI from '../src/lib/flow/aiyorum.ts';

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


// ───── 7) Akış filtreleri (Bugün / Dün / vade / min prim / taraf / hisse) ─────
{
  const EV = (o: Partial<M.FlowEvent> & { id: number }): M.FlowEvent => ({ ts: 1000 + o.id, day: '2026-11-16', ticker: 'QQQ', occ: 'O' + o.id, expiry: '2026-11-16',
    side: 'call', strike: 585, dv: 100, volume: 100, oi: 50, bid: 1, ask: 1.2, mid: 1.1, prem: 100000, volOi: 2, confirmed: true, wide: false, pushed: false,
    underlying: 580, ...o } as M.FlowEvent);
  const a = EV({ id: 1, prem: 600000 });                                                       // QQQ call, bugün, 0DTE
  const b = EV({ id: 2, ticker: 'SPY', side: 'put', strike: 580, day: '2026-11-13', expiry: '2026-11-20', prem: 60000 }); // SPY put, dün, haftalık
  const c = EV({ id: 3, ticker: 'QQQ', side: 'put', strike: 575, expiry: '2026-11-20', prem: 20000 });                 // QQQ put, bugün, haftalık
  const d = EV({ id: 4, ticker: 'NVDA', strike: 900, day: '2026-11-13', expiry: '2026-11-19', prem: 1200000 });       // NVDA call, dün, Perşembe vadesi (diğer)
  const all = [a, b, c, d];
  const mon = Date.parse('2026-11-16T15:00:00Z');
  const ids = (xs: M.FlowEvent[]) => xs.map(x => x.id).join(',');
  const base = FL.DEFAULT_FILTERS;

  const dt = FL.dayTargets(mon);
  ok('gün: Pazartesi → Bugün 2026-11-16, Dün 2026-11-13', dt.bugun === '2026-11-16' && dt.dun === '2026-11-13', JSON.stringify(dt));
  ok('filtre: varsayılan (3 gün, Hepsi) hepsini geçirir', ids(FL.applyFlowFilters(all, base, mon)) === '1,2,3,4');
  ok('filtre: hisse QQQ', ids(FL.applyFlowFilters(all, { ...base, ticker: 'QQQ' }, mon)) === '1,3');
  ok('filtre: taraf call', ids(FL.applyFlowFilters(all, { ...base, side: 'call' }, mon)) === '1,4');
  ok('filtre: taraf put', ids(FL.applyFlowFilters(all, { ...base, side: 'put' }, mon)) === '2,3');
  ok('filtre: Bugün → yalnız 2026-11-16 olayları', ids(FL.applyFlowFilters(all, { ...base, day: 'bugun' }, mon)) === '1,3');
  ok('filtre: Dün → önceki işlem günü (13 Kas)', ids(FL.applyFlowFilters(all, { ...base, day: 'dun' }, mon)) === '2,4');
  ok('filtre: min prim 100 bin $ (≥)', ids(FL.applyFlowFilters(all, { ...base, minPrem: 100000 }, mon)) === '1,4');
  ok('filtre: vade 0DTE (expiry = day)', ids(FL.applyFlowFilters(all, { ...base, expiry: 'zero' }, mon)) === '1');
  ok('filtre: vade haftalık (Cuma 11-20)', ids(FL.applyFlowFilters(all, { ...base, expiry: 'weekly' }, mon)) === '2,3');
  ok('filtre: Perşembe vadesi (Cuma açık) haftalık sayılmaz', FL.expiryKind(d) === 'other' && !FL.isWeeklyExpiry('2026-11-19'));
  ok('vade: 2027-03-25 (Cuma 26 Mart tatil) haftalık', FL.isWeeklyExpiry('2027-03-25') && !FL.isWeeklyExpiry('2027-03-24'));
  ok('vade: Cuma vadesi haftalık, Pazartesi vadesi değil', FL.isWeeklyExpiry('2026-11-20') && !FL.isWeeklyExpiry('2026-11-16'));
  const comb = ids(FL.applyFlowFilters(all, { ...base, ticker: 'QQQ', day: 'bugun', side: 'call', minPrem: 500000, expiry: 'zero' }, mon));
  ok('birleşik filtre: QQQ + Bugün + call + ≥500 bin + 0DTE → 1', comb === '1', comb);

  const sat = Date.parse('2026-11-14T15:00:00Z');   // Cumartesi
  ok('hafta sonu: Bugün (14 Kas) boş', FL.applyFlowFilters(all, { ...base, day: 'bugun' }, sat).length === 0);
  ok('hafta sonu: Dün = 13 Kas (Cuma)', ids(FL.applyFlowFilters(all, { ...base, day: 'dun' }, sat)) === '2,4' && FL.dayTargets(sat).dun === '2026-11-13');

  ok('tickersIn: DEFAULT sırası önce, sonra alfabetik', FL.tickersIn([{ ticker: 'ZZZ' }, { ticker: 'SPY' }, { ticker: 'AAA' }, { ticker: 'QQQ' }, { ticker: 'NVDA' }]).join(',') === 'QQQ,SPY,NVDA,AAA,ZZZ');
  const vf = FL.validFilters({ ticker: 'qqq', side: 'x', day: 'dun', minPrem: 999, expiry: 'weekly' });
  ok('validFilters: geçersiz alanlar varsayılana, geçerli dun/weekly korunur', vf.ticker === null && vf.side === 'all' && vf.minPrem === 0 && vf.day === 'dun' && vf.expiry === 'weekly', JSON.stringify(vf));
  const vp = FL.validPrefs({ view: 'dagilim', dagTicker: 'NVDA', filters: { ticker: 'QQQ' } });
  ok('validPrefs: view/dagTicker/filtre yüklenir; bozuk girdi varsayılan', vp.view === 'dagilim' && vp.dagTicker === 'NVDA' && vp.filters.ticker === 'QQQ' && FL.validPrefs(null).view === 'liste' && FL.validPrefs({ dagTicker: 'x y' }).dagTicker === null);

  // ───── Dağılım: toplama, spot, en yakın strike ─────
  const ag = DI.aggregateByStrike([EV({ id: 10, strike: 585, side: 'call', prem: 100, dv: 10 }), EV({ id: 11, strike: 585, side: 'call', prem: 50, dv: 5, expiry: '2026-11-20' }),
    EV({ id: 12, strike: 585, side: 'put', prem: 30, dv: 4 }), EV({ id: 13, strike: 590, side: 'call', prem: 10, dv: 1 })]);
  ok('toplama: 585 call 150 / put 30 / kontrat 15 / 4, net 120 (iki vade birleşir)', ag[1].strike === 585 && ag[1].callPrem === 150 && ag[1].putPrem === 30 && ag[1].callDv === 15 && ag[1].putDv === 4 && ag[1].net === 120, JSON.stringify(ag));
  ok('toplama: farklı strike ayrı satır, yüksekten düşüğe', ag.length === 2 && ag[0].strike === 590 && ag[0].callPrem === 10);
  ok('toplama: boş girdi → []', DI.aggregateByStrike([]).length === 0);
  const rowsX = [{ strike: 590, callPrem: 1, putPrem: 0, callDv: 0, putDv: 0, net: 1, total: 1 }, { strike: 585, callPrem: 2, putPrem: 0, callDv: 0, putDv: 0, net: 2, total: 2 }, { strike: 580, callPrem: 0, putPrem: 0, callDv: 0, putDv: 0, net: 0, total: 0 }];
  ok('atm: spot 583,4 → 585 (en yakın)', DI.atmStrike(rowsX, 583.4) === 585 && DI.atmStrike(rowsX, null) === null);
  ok('spotOf: en son non-null underlying (ts)', DI.spotOf([{ ts: 100, id: 1, underlying: 580 }, { ts: 200, id: 2, underlying: null }, { ts: 150, id: 3, underlying: 581 }]) === 581);
  ok('spotOf: eşit ts → büyük id', DI.spotOf([{ ts: 100, id: 5, underlying: 582 }, { ts: 100, id: 7, underlying: 583 }]) === 583);
  ok('spotOf: underlying yok → null', DI.spotOf([{ ts: 1, id: 1, underlying: null }]) === null);
  ok('strikeSide: üstünde / altında / seviyesinde', DI.strikeSide(585, 580) === 'above' && DI.strikeSide(575, 580) === 'below' && DI.strikeSide(580, 580) === 'at' && DI.strikeSide(580, null) === null);

  // ───── Kural tabanlı yorum ─────
  const R = (strike: number, callPrem: number, putPrem: number) => ({ strike, callPrem, putPrem, callDv: 0, putDv: 0, net: callPrem - putPrem, total: callPrem + putPrem });
  const callHeavy = [R(590, 50000, 0), R(585, 800000, 100000), R(580, 300000, 50000), R(570, 0, 200000)];
  const yUp = YO.interpretDistribution({ ticker: 'QQQ', rows: callHeavy, spot: 580, eventCount: 8, zeroDtePrem: 0, reconstructedCount: 0 });
  ok('yorum: call ağırlıklı, spot yakını → yukarı, güven yüksek', yUp.bias === 'yukarı' && yUp.confidence === 'yüksek' && yUp.summary.includes('Yukarı eğilim'), JSON.stringify(yUp));
  ok('yorum: maddeler en çok 5 (son madde yasal not) ve üst strike anılır', yUp.bullets.length <= 5 && yUp.bullets[yUp.bullets.length - 1] === YO.YORUM_CAVEAT && yUp.bullets.some(b => b.includes('585')));
  ok('yorum: spot varken direnç/destek yorumu', yUp.bullets.some(b => b.includes('spot üstü')) && yUp.bullets.some(b => b.includes('spot altı')));
  const putHeavy = callHeavy.map(r => R(r.strike, r.putPrem, r.callPrem));
  const yDn = YO.interpretDistribution({ ticker: 'QQQ', rows: putHeavy, spot: 580, eventCount: 8, zeroDtePrem: 0, reconstructedCount: 0 });
  ok('yorum: put ağırlıklı → aşağı', yDn.bias === 'aşağı' && yDn.summary.includes('Aşağı eğilim'), JSON.stringify(yDn.bias));
  const bal = YO.interpretDistribution({ ticker: 'QQQ', rows: [R(585, 500000, 450000)], spot: 585, eventCount: 6, zeroDtePrem: 0, reconstructedCount: 0 });
  ok('yorum: dengeli → kararsız, düşük değil ama yön yok', bal.bias === 'kararsız' && bal.summary.includes('dengeli'), JSON.stringify(bal));
  const emp = YO.interpretDistribution({ ticker: 'QQQ', rows: [], spot: null, eventCount: 0, zeroDtePrem: 0, reconstructedCount: 0 });
  ok('yorum: boş → kararsız, düşük, yeterli veri yok', emp.bias === 'kararsız' && emp.confidence === 'düşük' && emp.summary === 'Yeterli akış verisi yok.');
  const thin = YO.interpretDistribution({ ticker: 'QQQ', rows: [R(585, 90000, 0)], spot: 585, eventCount: 2, zeroDtePrem: 0, reconstructedCount: 0 });
  ok('yorum: az veri (2 olay, 90 bin) → kararsız + düşük', thin.bias === 'kararsız' && thin.confidence === 'düşük' && thin.bullets[0].includes('Veri az'), JSON.stringify(thin));
  const recon = YO.interpretDistribution({ ticker: 'QQQ', rows: callHeavy, spot: 580, eventCount: 8, zeroDtePrem: 0, reconstructedCount: 8 });
  ok('yorum: yalnız sonradan kurulmuş veri → güven en çok orta + kapanış uyarısı', recon.bias === 'yukarı' && recon.confidence === 'orta' && recon.bullets.some(b => b.includes('sonradan kuruldu')), JSON.stringify(recon));
  const far = YO.interpretDistribution({ ticker: 'QQQ', rows: [R(650, 900000, 0), R(580, 0, 100000)], spot: 580, eventCount: 5, zeroDtePrem: 0, reconstructedCount: 0 });
  ok('yorum: prim yalnız uzak OTM kanadında → kararsız', far.bias === 'kararsız' && far.summary.includes('uzak strike'), JSON.stringify(far.summary));
  const noSpot = YO.interpretDistribution({ ticker: 'QQQ', rows: callHeavy, spot: null, eventCount: 8, zeroDtePrem: 300000, reconstructedCount: 0 });
  ok('yorum: spot yok → seviye olarak okunur, 0DTE maddesi', noSpot.bias === 'yukarı' && noSpot.bullets.some(b => b.includes('spot yok')) && noSpot.bullets.some(b => b.includes('0DTE')));
  ok('yorum: yasal not her zaman son madde', [yUp, yDn, bal, emp, thin, recon, far, noSpot].every(y => y.bullets.at(-1) === 'Yatırım tavsiyesi değildir.'));

  // ───── AI yorum: payload (sunucu tarafı saf kısmı) ─────
  const pay = AI.buildFlowYorumPayload('QQQ', '2026-11-13', [EV({ id: 20, day: '2026-11-13', expiry: '2026-11-13', prem: 300000, strike: 585 }), EV({ id: 21, day: '2026-11-13', expiry: '2026-11-20', prem: 100000, strike: 590, side: 'put', underlying: 581 })], null);
  ok('AI payload: 0DTE payı %75, spot son olaydan, duvar yok', !!pay && pay.zeroDteSharePct === 75 && pay.spot === 581 && pay.walls === null && pay.eventCount === 2, JSON.stringify(pay));
  ok('AI payload: başka hisse/gün karışmaz; olay yok → null', AI.buildFlowYorumPayload('SPY', '2026-11-13', [EV({ id: 22, day: '2026-11-13' })], null) === null);
  const txt = pay ? AI.flowYorumUserText(pay) : '';
  ok('AI metni: hisse, spot, strike tablosu ve duvar yok uyarısı', txt.includes('Hisse: QQQ') && txt.includes('585 |') && txt.includes('OI duvarları: yok'));
  ok('AI sistem metni: yatırım tavsiyesi yasağı ve son cümle', AI.FLOW_YORUM_SYSTEM.includes('Yatırım tavsiyesi değildir.') && AI.FLOW_YORUM_SYSTEM.includes('uydurma'));
  ok('URL: flowYorumUrl (ticker+day sorguda, sondaki / temizlenir)', X.flowYorumUrl('https://h/', 'QQQ', '2026-11-13') === 'https://h/flow/yorum?ticker=QQQ&day=2026-11-13');
}

// Aylık opex filtresi (3. Cuma) ve 2 ay penceresi
{
  const now = Date.parse('2026-11-14T15:00:00Z');
  ok('aylık opex: 2026-11-20 (3. Cuma) pencerede', FL.isMonthlyWindow('2026-11-20', now) === true);
  ok('aylık opex: 2026-11-13 haftalık, aylık değil', FL.isMonthlyWindow('2026-11-13', now) === false);
  ok('aylık opex: 2027-03-19 pencere (2 ay) dışında', FL.isMonthlyWindow('2027-03-19', now) === false);
  ok('aylık opex: 2027-01-15 (3. Cuma Oca) pencere dışı (2 ay = 14 Oca)', FL.isMonthlyWindow('2027-01-15', now) === false);
  const ev = (expiry: string, day: string) => ({ id: expiry + day, ticker: 'MU', side: 'call', expiry, day, prem: 1e6, ts: 0 }) as unknown as M.FlowEvent;
  const out = FL.applyFlowFilters([ev('2026-11-20', '2026-11-14'), ev('2026-11-13', '2026-11-13')], { ...FL.DEFAULT_FILTERS, expiry: 'monthly', day: 'uc' }, now);
  ok('filtre: yalnız aylık opex vadesi kalır', out.length === 1 && out[0].expiry === '2026-11-20', String(out.length));
}
console.log(fail ? `\n${fail} FLOW TESTİ BAŞARISIZ` : '\nFLOW testleri geçti');
process.exit(fail ? 1 : 0);
