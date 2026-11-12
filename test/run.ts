import * as BS from '../src/lib/bs.ts';
import * as St from '../src/lib/strategy.ts';
import * as A from '../src/lib/american.ts';
import * as M from '../src/lib/usmarket.ts';
// @ts-ignore — Node yerleşik modülü (test yalnızca Node'da çalışır)
import { readFileSync } from 'node:fs';
import * as MD from '../src/lib/market/index.ts';
import * as MDT from '../src/lib/market/types.ts';
import * as CB from '../src/lib/market/cboe.ts';
import * as YH from '../src/lib/market/yahoo.ts';
import * as TR from '../src/lib/market/tradier.ts';
import { fmt, parseNum, parseTrDate } from '../src/lib/format.ts';
let fail = 0;
function eq(name: string, got: number, exp: number, tol = 1e-3) { const ok = Math.abs(got - exp) <= tol; if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + ' = ' + (+got).toFixed(6) + ' (beklenen ' + exp + ')'); }
// Hull / standart referans değerleri
eq('Call S100 K100 T1 r5 s20', BS.price('call', 100, 100, 1, .05, 0, .2), 10.4506);
eq('Put  S100 K100 T1 r5 s20', BS.price('put', 100, 100, 1, .05, 0, .2), 5.5735);
eq('Hull 15.6 call S42 K40 T.5 r10 s20', BS.price('call', 42, 40, .5, .1, 0, .2), 4.7594);
eq('Hull 15.6 put', BS.price('put', 42, 40, .5, .1, 0, .2), 0.8086);
eq('Merton (Haug) put S100 K95 T.5 r10 q5 s20', BS.price('put', 100, 95, .5, .1, .05, .2), 2.4648);
eq('Merton call (parite ile) S100 K95 T.5 r10 q5 s20', BS.price('call', 100, 95, .5, .1, .05, .2), 2.4648 + 100*Math.exp(-.025) - 95*Math.exp(-.05), 1e-3);
// put-call parity
const c = BS.price('call', 123, 110, .7, .04, .015, .37), p = BS.price('put', 123, 110, .7, .04, .015, .37);
eq('Put-call parity', c - p, 123 * Math.exp(-.015 * .7) - 110 * Math.exp(-.04 * .7), 1e-9);
// Greek'ler (Hull 19: S49 K50 r5 s20 T.3846)
const g = BS.greeks('call', 49, 50, .3846, .05, 0, .2);
eq('Hull delta', g.delta, 0.522, 1e-3); eq('Hull gamma', g.gamma, 0.066, 1e-3);
eq('Hull theta/yıl', g.theta * 365, -4.31, 1e-2); eq('Hull vega (1%)', g.vega, 0.121, 1e-3); eq('Hull rho (1%)', g.rho, 0.089, 1e-3);
// Greek'ler sayısal türevle
const f = (S: number, T: number, s: number, r: number) => BS.price('put', S, 105, T, r, .02, s), h = 1e-4, G = BS.greeks('put', 100, 105, .5, .03, .02, .25);
eq('put delta ~ sayısal', G.delta, (f(100 + h, .5, .25, .03) - f(100 - h, .5, .25, .03)) / (2 * h), 1e-6);
eq('put gamma ~ sayısal', G.gamma, (f(100 + 1e-2, .5, .25, .03) - 2 * f(100, .5, .25, .03) + f(100 - 1e-2, .5, .25, .03)) / 1e-4, 1e-5);
eq('put vega ~ sayısal', G.vega, (f(100, .5, .25 + h, .03) - f(100, .5, .25 - h, .03)) / (2 * h) / 100, 1e-6);
eq('put rho ~ sayısal', G.rho, (f(100, .5, .25, .03 + h) - f(100, .5, .25, .03 - h)) / (2 * h) / 100, 1e-6);
eq('put theta ~ sayısal', G.theta, -(f(100, .5 + h, .25, .03) - f(100, .5 - h, .25, .03)) / (2 * h) / 365, 1e-6);
eq('IV çözücü', BS.impliedVol('call', 10.4506, 100, 100, 1, .05, 0), 0.2, 1e-4);
eq('IV çözücü OTM put', BS.impliedVol('put', BS.price('put', 100, 80, .1, .04, 0, .55), 100, 80, .1, .04, 0), 0.55, 1e-6);
// ===================== AMERİKAN TİPİ MOTOR =====================
console.log('\n— Amerikan tipi (Leisen-Reimer + Richardson) —');
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };
// Hull "American put" örneği: S=50 K=50 r=10% σ=40% T=5/12
eq('Hull 5 adımlı CRR ağacı (kitap: 4,49)', A.tree('put', 50, 50, 5 / 12, .1, 0, .4, [], 5, 'crr').american, 4.49, 0.005);
eq('Hull 5 adımlı Avrupa (kitap: 4,32)', A.tree('put', 50, 50, 5 / 12, .1, 0, .4, [], 5, 'crr').european, 4.32, 0.005);
const crr = (n: number) => A.tree('put', 50, 50, 5 / 12, .1, 0, .4, [], n, 'crr').american;
const hullRef = 2 * crr(8000) - crr(4000); // bağımsız referans: çok ince CRR + Richardson
eq('Bağımsız referans (CRR 8000, Richardson) ≈ 4,2842', hullRef, 4.2842, 0.0005);
eq('Hull 500 adım (kitap: 4,283)', crr(500), 4.283, 0.0006);
const hullAm = A.americanPrice('put', 50, 50, 5 / 12, .1, 0, .4);
eq('Uygulama motoru Hull Amerikan put', hullAm, hullRef, 0.0005);
eq('Avrupa put (BSM) aynı girdiler', BS.price('put', 50, 50, 5 / 12, .1, 0, .4), 4.0760, 0.0005);
ok('Amerikan put > Avrupa put (erken kullanım primi ' + (hullAm - BS.price('put', 50, 50, 5 / 12, .1, 0, .4)).toFixed(4) + ')', hullAm > BS.price('put', 50, 50, 5 / 12, .1, 0, .4) + 0.1);
// Hull nakit temettü örneği: S=52 K=50, 3,5. ayda 2,06$ temettü, 5 adım → 4,44
eq('Hull temettülü put (5 adım, kitap: 4,44)', A.tree('put', 52, 50, 5 / 12, .1, 0, .4, [{ t: 3.5 / 12, amount: 2.06 }], 5, 'crr').american, 4.44, 0.005);
// Geske-Johnson / Barone-Adesi-Whaley tablosu "doğru değerler" (S=40, r=4,88%)
for (const [K, s, T, ref] of [[35, .2, .3333, .2004], [40, .2, .0833, .8522], [40, .2, .5833, 1.9905], [45, .2, .3333, 5.0883], [45, .2, .5833, 5.2670], [45, .4, .5833, 7.3830]])
  eq(`Geske-Johnson put K${K} σ${s} T${T}`, A.americanPrice('put', 40, K, T, .0488, 0, s), ref, 0.0012);
// Derin ITM: Amerikan put > Avrupa put
const dA = A.americanPrice('put', 40, 60, 1, .05, 0, .25), dE = BS.price('put', 40, 60, 1, .05, 0, .25);
ok('Derin ITM put: Amerikan ' + dA.toFixed(4) + ' > Avrupa ' + dE.toFixed(4) + ' ve = içsel 20', dA > dE + 0.5 && Math.abs(dA - 20) < 1e-3);
// Temettüsüz call: Amerikan = Avrupa (hem kısa yol hem ağaç)
eq('Temettüsüz call Amerikan = BSM', A.americanPrice('call', 100, 100, 1, .05, 0, .2), 10.4506, 1e-4);
const tc = A.tree('call', 100, 90, 1, .05, 0, .3, [], 151);
eq('Temettüsüz call ağaçta erken kullanım yok (Amerikan − Avrupa)', tc.american - tc.european, 0, 1e-12);
// Temettülü call: erken kullanım primi > 0
const cq = A.americanPrice('call', 100, 80, 1, .05, .06, .2), cqE = BS.price('call', 100, 80, 1, .05, .06, .2);
ok('q=%6 derin ITM call: Amerikan ' + cq.toFixed(4) + ' > Avrupa ' + cqE.toFixed(4), cq > cqE + 0.05);
const cd = A.americanPrice('call', 100, 90, .25, .045, 0, .25, [{ t: .1, amount: 3 }]), cdE = A.europeanPrice('call', 100, 90, .25, .045, 0, .25, [{ t: .1, amount: 3 }]);
ok('Ex-temettü öncesi ITM call: Amerikan ' + cd.toFixed(4) + ' > Avrupa ' + cdE.toFixed(4), cd > cdE + 0.05);
// Yakınsama
const pN = (n: number) => A.americanPrice('put', 50, 50, 5 / 12, .1, 0, .4, [], n);
ok('Yakınsama: |P(51)−ref| ' + Math.abs(pN(51) - hullRef).toExponential(2) + ' > |P(151)−ref| ' + Math.abs(pN(151) - hullRef).toExponential(2) + ', |P(401)−ref| ' + Math.abs(pN(401) - hullRef).toExponential(2) + ' < 2e-4',
  Math.abs(pN(51) - hullRef) > Math.abs(pN(151) - hullRef) && Math.abs(pN(401) - hullRef) < 2e-4);
eq('Hızlı mod (grafik, 41 adım) hatası küçük', pN(A.FAST_STEPS), hullRef, 0.003);
// Greek'ler (Hull 5 adımlı ağaç tahmini: Δ −0,41, Γ 0,03, Θ −0,012/gün, Vega 0,13)
const ag = A.americanGreeks('put', 50, 50, 5 / 12, .1, 0, .4);
eq('Amerikan put delta', ag.delta, -0.414, 0.01); eq('Amerikan put gamma', ag.gamma, 0.033, 0.004);
eq('Amerikan put theta/gün', ag.theta, -0.0117, 0.001); eq('Amerikan put vega', ag.vega, 0.123, 0.006);
const dnum = (A.americanPrice('put', 50.05, 50, 5 / 12, .1, 0, .4, [], 801) - A.americanPrice('put', 49.95, 50, 5 / 12, .1, 0, .4, [], 801)) / .1;
eq('Delta ≈ ince ağaç sayısal türevi', ag.delta, dnum, 0.005);
const cg = A.americanGreeks('call', 49, 50, .3846, .05, 0, .2);
eq('Temettüsüz call Greek = BSM (Hull delta)', cg.delta, 0.522, 1e-3);
// IV gidiş-dönüş
for (const [ty, S0, K, T, r, q, s, dv] of [['put', 50, 50, 5 / 12, .1, 0, .4, []], ['put', 100, 130, .5, .045, 0, .35, []], ['put', 100, 80, .1, .04, 0, .65, []],
  ['call', 100, 90, .25, .045, 0, .25, [{ t: .1, amount: 3 }]], ['call', 250, 260, .08, .042, .005, .28, []]] as [A.OptType, number, number, number, number, number, number, A.CashDiv[]][]) {
  const pr = A.americanPrice(ty, S0, K, T, r, q, s, dv);
  eq(`IV gidiş-dönüş ${ty} S${S0} K${K} σ${s}`, A.americanIV(ty, pr, S0, K, T, r, q, dv), s, 1e-5);
}
ok('İçsel değerin altındaki prim → IV yok (NaN)', isNaN(A.americanIV('put', 19.5, 40, 60, 1, .05, 0)));

// ===================== ABD TAKVİMİ =====================
console.log('\n— ABD piyasa takvimi —');
const chk0 = (name: string, got: unknown, exp: unknown) => ok(name + ' = ' + String(got), got === exp, '(beklenen ' + String(exp) + ')');
const now0 = Date.parse('2026-11-12T08:46:00Z');
chk0('ET farkı Kasım (EST)', M.etOffset(now0), -5);
chk0('ET farkı Temmuz (EDT)', M.etOffset(Date.parse('2026-07-01T12:00:00Z')), -4);
chk0('13.11.2026 kapanış 16:00 ET', new Date(M.closeMs('2026-11-13')).toISOString(), '2026-11-13T21:00:00.000Z');
chk0('Varsayılan vade (≥21 gün, aylık 3. Cuma)', M.defaultExpiry(now0), '2026-12-18');
const ex = M.expirations(now0);
chk0('İlk vade haftalık Cuma', ex[0].date, '2026-11-13');
chk0('20.11.2026 aylık', ex.find(e => e.date === '2026-11-20')?.monthly, true);
chk0('Noel Cuması → 24.12.2026 Perşembe vadesi', ex.some(e => e.date === '2026-12-24'), true);
chk0('Good Friday 2027 tatil → önceki işlem günü', M.prevTradingDay('2027-03-26'), '2027-03-25');
chk0('Ocak 2028 LEAPS listede', ex.some(e => e.date === '2028-01-21'), true);

// ===================== STRATEJİ =====================
console.log('\n— Strateji —');
const gl: St.Globals = { S: 100, r: 4.3, q: 0, divs: [], now: now0 }, exp = '2026-12-11';
const L = (kind: St.LegKind, side: number, strike: number, premium: number): St.Leg => ({ kind, side, strike, expiry: exp, iv: 30, qty: 1, premium });
let a = St.analyze([L('call', 1, 100, 3), L('call', -1, 110, 1)], gl);
eq('Bull call max kâr', a.maxProfit, 800); eq('Bull call max zarar', a.maxLoss, -200); eq('Bull call başabaş', a.breakevens[0], 102);
a = St.analyze([L('call', 1, 100, 3), L('put', 1, 100, 2.5)], gl);
console.log((a.maxProfit === Infinity ? 'OK  ' : (fail++, 'FAIL')) + ' Straddle sınırsız kâr');
eq('Straddle başabaş alt', a.breakevens[0], 94.5); eq('Straddle başabaş üst', a.breakevens[1], 105.5); eq('Straddle max zarar', a.maxLoss, -550);
a = St.analyze([L('put', 1, 85, .2), L('put', -1, 90, .6), L('call', -1, 110, .7), L('call', 1, 115, .3)], gl);
eq('Iron condor max kâr', a.maxProfit, 80); eq('Iron condor max zarar', a.maxLoss, -420); eq('IC başabaş alt', a.breakevens[0], 89.2); eq('IC başabaş üst', a.breakevens[1], 110.8);
a = St.analyze([L('call', -1, 100, 3)], gl);
console.log((a.maxLoss === -Infinity ? 'OK  ' : (fail++, 'FAIL')) + ' Naked short call sınırsız zarar');
a = St.analyze([{ kind: 'stock', side: 1, qty: 100, premium: 100, strike: 0, expiry: exp, iv: 0 }, L('call', -1, 105, 2)], gl);
eq('Covered call max kâr', a.maxProfit, 700); eq('Covered call başabaş', a.breakevens[0], 98);
a = St.analyze([L('put', -1, 95, 2)], gl);
eq('Cash-secured put max kâr', a.maxProfit, 200); eq('CSP max zarar', a.maxLoss, -9300); eq('CSP başabaş', a.breakevens[0], 93);
// Kâr olasılığı: ~ P(S_T > S0) lognormal, süre 16:00 ET kapanışına göre
a = St.analyze([L('call', 1, 100, 0.000001)], gl);
const T = St.yearsLeft(gl, St.todayOf(gl), exp), s = .3, d2 = (Math.log(100 / 100) + (.043 - s * s / 2) * T) / (s * Math.sqrt(T));
eq('Vadeye süre (yıl) = (11.12 21:00Z − şimdi)/365g', T, (Date.parse('2026-12-11T21:00:00Z') - now0) / (365 * 864e5), 1e-12);
eq('POP ~ N(d2)', a.pop, BS.ncdf(d2), 1e-5);
// Bugün, hedef = spot, prim boş → K/Z = 0 (giriş = teorik)
const pl0 = St.pnl([{ ...L('put', 1, 105, 0), premium: null }], gl, 100, St.todayOf(gl));
eq('Prim boşken bugünkü K/Z = 0', pl0, 0, 1e-9);
// Prim → IV (Amerikan) → teorik = prim
const lp: St.Leg = { ...L('put', 1, 110, 0), premium: null };
const ivp = St.legIV(lp, gl, 11.2);
eq('Primden IV, sonra teorik = prim', St.legTheo({ ...lp, iv: ivp }, gl), 11.2, 1e-6);
// Temettü: covered call hisse bacağı, alınan temettüyü sayar
const gd: St.Globals = { ...gl, divs: [{ date: '2026-11-20', amount: 1 }] };
eq('Hisse bacağı: ex-tarih sonrası değer = fiyat + temettü', St.legValue({ kind: 'stock', side: 1, qty: 100, premium: 100, strike: 0, expiry: exp, iv: 0 }, gd, 99, '2026-11-25'), 100, 1e-12);

// ===================== PİYASA VERİSİ (kayıtlı fixture'lar) =====================
console.log('\n— Piyasa verisi ayrıştırıcıları —');
{
  const fx = (f: string) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
  const occ = MDT.parseOcc('SPXW261218P05825000');
  chk0('OCC sembolü', JSON.stringify(occ), JSON.stringify({ root: 'SPXW', expiry: '2026-12-18', type: 'put', strike: 5825 }));
  chk0('CBOE ET saati → UTC', new Date(CB.etNaive('2026-11-11T15:59:59')).toISOString(), '2026-11-11T20:59:59.000Z');
  const cj = fx('cboe-AAPL.json'), cq = CB.parseCboeQuote(cj, 'AAPL', now0);
  eq('CBOE fiyat (seans kapalı → resmi kapanış)', cq.price, 355.63, 1e-9); eq('CBOE seans dışı fiyat', cq.extPrice!, 356.2062, 1e-9);
  eq('CBOE fiyat (seans açık → güncel)', CB.parseCboeQuote(cj, 'AAPL', Date.parse('2026-11-12T18:00:00Z')).price, 356.2062, 1e-9); eq('CBOE değişim %', cq.changePct, 2.043, 1e-9); chk0('CBOE gecikme', cq.delayedMin, 15);
  const ch = CB.parseCboeChains(cj, 'AAPL', now0);
  chk0('CBOE: geçmiş vade (11.11) atıldı, kalan vadeler', [...ch.keys()].join(','), '2026-12-18');
  const dec = ch.get('2026-12-18')!, c355 = dec.calls.find(o => o.strike === 355)!;
  chk0('CBOE 355C bid/ask', `${c355.bid}/${c355.ask}`, '11/11.3'); eq('CBOE 355C IV', c355.iv!, 0.2268, 1e-9); chk0('CBOE 355C OI', c355.oi, 5463);
  eq('Mid fiyat', MDT.mid(c355), 11.15, 1e-9);
  ok('CBOE strike sıralı', dec.calls.every((o, i, a) => !i || a[i - 1].strike < o.strike));
  // SPX/SPXW aynı gün → PM (SPXW) tercih; düzeltilmiş kök (AAPL1) atılır
  const syn = { data: { current_price: 5800, options: [
    { option: 'SPX261218C05800000', bid: 1, ask: 2, iv: .2, open_interest: 10, volume: 0, last_trade_price: 1.5 },
    { option: 'SPXW261218C05800000', bid: 3, ask: 4, iv: .21, open_interest: 20, volume: 0, last_trade_price: 3.5 },
    { option: 'SPX1261218C05800000', bid: 9, ask: 9, iv: .3, open_interest: 1, volume: 0, last_trade_price: 9 } ] } };
  const sc = CB.parseCboeChains(syn, 'SPX', now0).get('2026-12-18')!;
  chk0('SPX/SPXW tekilleştirme (PM tercih), düzeltilmiş kök atıldı', `${sc.calls.length}:${sc.calls[0].bid}`, '1:3');
  // Yahoo
  const yj = fx('yahoo-KO.json'), yp = YH.parseYahooOptions(yj);
  eq('Yahoo fiyat', yp.quote.price, 97.57, 1e-9); eq('Yahoo temettü verimi % (2,12/97,57)', yp.quote.divYield!, 2.12 / 97.57 * 100, 1e-9);
  chk0('Yahoo vade listesi (UTC gece yarısı → tarih)', yp.expirations.slice(0, 3).join(','), '2026-11-13,2026-11-20,2026-11-27');
  chk0('Yahoo zincir vadesi', yp.chain!.expiry, '2026-11-13');
  ok('Yahoo bid/ask=0 iken sahte IV (1e-5) atıldı', yp.chain!.calls.every(o => o.iv === null || o.iv > 0.005));
  const y95 = yp.chain!.calls.find(o => o.strike === 95)!;
  eq('Yahoo bid/ask yoksa mid = son işlem', MDT.mid(y95), y95.bid > 0 && y95.ask > 0 ? (y95.bid + y95.ask) / 2 : y95.last, 1e-9);
  // Tradier (dokümandaki biçim)
  const tq = TR.parseTradierQuote({ quotes: { quote: { symbol: 'AAPL', description: 'Apple Inc', last: 355.6, change: 7.1, change_percentage: 2.04, prevclose: 348.5, bid: 355.5, ask: 355.7, trade_date: 1794430801000 } } });
  eq('Tradier fiyat', tq.price, 355.6, 1e-9); chk0('Tradier gerçek zamanlı', tq.delayedMin, 0);
  const tc = TR.parseTradierChain({ options: { option: [
    { symbol: 'AAPL261218C00355000', option_type: 'call', strike: 355, bid: 11, ask: 11.3, last: 11.2, volume: 1649, open_interest: 5463, greeks: { delta: .54, mid_iv: .2268 } },
    { symbol: 'AAPL261218P00355000', option_type: 'put', strike: 355, bid: 9, ask: 9.3, last: 9.1, volume: 10, open_interest: 50, greeks: { delta: -.46, mid_iv: .231 } } ] } }, '2026-12-18');
  chk0('Tradier zincir', `${tc.calls.length}/${tc.puts.length} ${tc.calls[0].iv}`, '1/1 0.2268');
  chk0('Tradier tek kontrat (dizi değil) da çalışır', TR.parseTradierChain({ options: { option: { option_type: 'put', strike: 1, bid: 0, ask: 0, last: 0 } } }, 'x').puts.length, 1);
  // Yardımcılar
  chk0('En yakın strike', MD.nearest(dec.calls, 356.2)!.strike, 355);
  chk0('ATM çevresi 2+1+2', MD.around(dec.calls, 356.2, 2).map(o => o.strike).join(','), '345,350,355,360,365');
  chk0('Hedefe en yakın gerçek vade', MD.closestExpiry(['2026-12-11', '2026-12-18', '2027-01-15'], '2026-12-20'), '2026-12-18');
  chk0('Piyasa açık mı (Perşembe 15:00 ET)', MD.marketOpen(Date.parse('2026-11-12T20:00:00Z')), true);
  chk0('Piyasa kapalı (Thanksgiving)', MD.marketOpen(Date.parse('2026-11-26T17:00:00Z')), false);
  // Zincir primi → Amerikan IV → teorik prim (uygulamanın akışı)
  const gA: St.Globals = { S: cq.price, r: 4.2, q: 0.3, divs: [], now: now0 };
  const legA: St.Leg = { kind: 'call', side: 1, strike: 355, expiry: '2026-12-18', iv: 30, qty: 1, premium: MDT.mid(c355) };
  const ivA = St.legIV(legA, gA, legA.premium!);
  ok(`Kendi Amerikan IV'miz (mid 11,15'ten) %${ivA.toFixed(2)} ≈ CBOE IV %22,68 (±0,5 puan)`, Math.abs(ivA - 22.68) < 0.5);
}
// Biçimlendirme / ayrıştırma
const chk = (name: string, got: unknown, exp: unknown) => { const ok = got === exp; if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + ' = ' + String(got) + ' (beklenen ' + String(exp) + ')'); };
chk('fmt 1234567,891', fmt(1234567.891, 2), '1.234.567,89');
chk('fmt -0,001 → 0,00', fmt(-0.001, 2), '0,00');
chk('parseNum "1.234,5"', parseNum('1.234,5'), 1234.5);
chk('parseNum "12,5 $"', parseNum('12,5 $'), 12.5);
chk('parseTrDate 13.11.2026', parseTrDate('13.11.2026'), '2026-11-13');
chk('parseTrDate 31.02.2026 geçersiz', parseTrDate('31.02.2026'), null);
console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nTüm testler geçti'); process.exit(fail ? 1 : 0);
