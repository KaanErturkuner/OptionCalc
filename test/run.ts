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
import * as MDA from '../src/lib/market/marketdata.ts';
import { parseYahooChart } from '../src/lib/market/bars.ts';
import * as AN from '../src/lib/odte/analytics.ts';
import * as SG from '../src/lib/odte/signal.ts';
import * as J from '../src/lib/journal.ts';
import * as AL from '../src/lib/alerts.ts';
import { tableRows, priceStep, MAX_ROWS } from '../src/lib/state.ts';
import * as STR from '../src/lib/odte/strategies/index.ts';
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
// ===================== MARKETDATA.APP AYRIŞTIRICI =====================
console.log('\n— MarketData.app —');
const fx2 = (f: string) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
{
  const q = MDA.parseMdQuote({ s: 'ok', symbol: ['SPY'], last: [759.81], change: [9.9], changepct: [0.0132], bid: [759.8], ask: [759.85], volume: [1000], updated: [1794430863] }, 'SPY');
  eq('MD quote fiyat', q.price, 759.81, 1e-9); eq('MD changepct kesir → %', q.changePct, 1.32, 1e-9); ok('MD zaman (ms)', q.time === 1794430863000);
  chk0('MD expirations', MDA.parseMdExpirations({ s: 'ok', expirations: ['2026-11-12', '2026-11-13'] }).join(','), '2026-11-12,2026-11-13');
  const c = MDA.parseMdChain({ s: 'ok', optionSymbol: ['SPY261112C00760000', 'SPY261112P00760000'], side: ['call', 'put'], strike: [760, 760], bid: [1.2, 1.5], ask: [1.25, 1.55],
    last: [1.22, 1.5], volume: [100, 200], openInterest: [1000, 2000], iv: [0.12, 0.13], delta: [0.48, -0.52], gamma: [0.09, 0.09], underlyingPrice: [759.9], updated: [1794430863] }, '2026-11-12');
  ok('MD zincir call/put', c.calls.length === 1 && c.puts.length === 1 && c.puts[0].oi === 2000 && c.calls[0].gamma === 0.09);
  eq('MD zincir dayanak', c.underlying!, 759.9, 1e-9);
  const cd = MDA.parseMdCandles({ s: 'ok', t: [1794407400, 1794407460], o: [1, 2], h: [2, 3], l: [0.5, 1.5], c: [1.5, 2.5], v: [10, 20] });
  ok('MD mumlar', cd.length === 2 && cd[1].t === 1794407460000 && cd[1].c === 2.5);
  const nowOpen = Date.parse('2026-11-12T16:00:00Z'); // 11:00 ET
  ok('isStale: önceki seans verisi (açık piyasa) bayat', MDA.isStale(1794430863000, nowOpen));
  ok('isStale: 2 dk önceki veri taze', !MDA.isStale(nowOpen - 120000, nowOpen));
  ok('isStale: kapalıyken son seans kapanışı taze', !MDA.isStale(Date.parse('2026-11-11T21:01:00Z'), Date.parse('2026-11-12T03:00:00Z')));
}
// ===================== 0DTE ANALİTİK + SİNYAL MOTORU (fikstür: SPY 11 Kas 2026) =====================
console.log('\n— 0DTE motoru —');
{
  const bars = parseYahooChart(fx2('yahoo-SPY-1m.json'));
  ok('Yahoo 1 dk bar sayısı 391', bars.length === 391);
  const chs = CB.parseCboeChains(fx2('cboe-SPY-0dte.json'), 'SPY', Date.parse('2026-11-11T15:00:00Z'));
  const ch = chs.get('2026-11-12')!;
  ok('0DTE zinciri yüklendi', !!ch && ch.calls.length > 50 && ch.calls.every(o => o.gamma != null));
  const now = Date.parse('2026-11-11T17:00:00Z'), bb = bars.filter(b => b.t <= now), S = bb[bb.length - 1].c;
  const sess = AN.sessionBars(bars, now);
  ok('Seans barları (09:30–12:00 ET)', sess.length === 151, String(sess.length));
  let pv = 0, vv = 0; for (const b of sess) { pv += (b.h + b.l + b.c) / 3 * b.v; vv += b.v; }
  eq('VWAP', AN.vwap(sess)!, pv / vv, 1e-9);
  const or15 = AN.openingRange(sess, 15)!;
  ok('ORB 15 dk', or15.complete && or15.high >= or15.low && or15.high === Math.max(...sess.slice(0, 15).map(b => b.h)));
  ok('ORB oluşmadan tamamlanmamış', !AN.openingRange(sess.slice(0, 5), 15)!.complete);
  eq('EMA sabit seri', AN.ema([5, 5, 5, 5], 3)[3], 5, 1e-12);
  const ks = [...new Set(ch.calls.map(o => o.strike))];
  const pain = (x: number) => ch.calls.reduce((a, o) => a + Math.max(x - o.strike, 0) * o.oi, 0) + ch.puts.reduce((a, o) => a + Math.max(o.strike - x, 0) * o.oi, 0);
  const mpRef = ks.reduce((a, b) => pain(b) < pain(a) ? b : a);
  ok('Max pain elle', AN.maxPain(ch) === mpRef, String(mpRef));
  const w = AN.oiWalls(ch);
  ok('OI duvarları en yüksek OI', w.callWall === [...ch.calls].sort((a, b) => b.oi - a.oi)[0].strike && w.putWall === [...ch.puts].sort((a, b) => b.oi - a.oi)[0].strike);
  const g = AN.gex(ch, S, now);
  ok('GEX: flip bulundu', g.flip != null && Math.abs(g.flip - S) / S < 0.15, String(g.flip));
  ok('GEX: strike toplamı ≈ net', Math.abs(g.strikes.reduce((a, x) => a + x.g, 0) - g.net) < 1e-6 * Math.abs(g.net) + 1);
  const em = AN.expectedMove(ch, S)!;
  const k0 = em.strike;
  eq('Beklenen hareket = ATM straddle', em.move, MDT.mid(ch.calls.find(o => o.strike === k0)!) + MDT.mid(ch.puts.find(o => o.strike === k0)!), 1e-9);
  const ra = AN.ratios(ch);
  ok('P/C oranları pozitif', ra.pcVol! > 0 && ra.pcOI! > 0);
  ok('Sıra dışı hacim kuralı (hacim ≥ 2×OI, ≥500)', AN.unusual(ch).every(u => u.vol >= 500 && u.vol >= 2 * u.oi));
  const V1 = SG.V1_OPTS; // fikstür testleri v1 kurallarıyla (v2 daha seçici)
  const r = SG.analyze('SPY', S, ch, bb, now, V1);
  ok('12:00 ET sinyal üretildi (CALL)', !!r.signal && r.signal.dir === 'call', r.noSignal ?? '');
  const sg = r.signal!;
  ok('Sinyal R/R ≥ 1,5 ve hedef > giriş > stop', sg.rr >= 1.5 && sg.target > sg.entry && sg.entry > sg.stop);
  ok('Giriş ≤ ask, likidite filtresi', sg.entry <= sg.ask && (sg.ask - sg.bid) / sg.mid <= V1.maxSpread);
  ok('Gerekçeler listesi', r.reasons.length >= 5 && r.reasons.some(x => /VWAP/.test(x.text)));
  chk0('Sinyal metni', SG.signalText({ ...sg, dte: 0, exitBy: '15:30 ET', strike: 590, entry: 1.2, target: 2, stop: 0.8 }), 'SPY 0DTE 590C AL — giriş ≤ $1.20, kâr al $2.00, stop $0.80, en geç 15:30 ET çık');
  chk0('1DTE etiketi', String(sg.dte), '1');
  const out = SG.outcome(sg, bars, Date.parse('2026-11-12T00:00:00Z'));
  ok('Sonuç takibi: hedef/stop/süre', ['target', 'stop', 'expired'].includes(out.status), out.status);
  const early = Date.parse('2026-11-11T14:40:00Z');
  chk0('İlk 15 dk sinyal yok', String(SG.analyze('SPY', S, ch, bars.filter(b => b.t <= early), early, V1).noSignal), 'Açılış aralığı oluşuyor (ilk 15 dk)');
  const late = Date.parse('2026-11-11T20:10:00Z');
  chk0('15:00 ET sonrası giriş yok', String(SG.analyze('SPY', S, ch, bars.filter(b => b.t <= late), late, V1).noSignal), '15:00 ET sonrası yeni giriş yok');
  chk0('Piyasa kapalı', String(SG.analyze('SPY', S, ch, bars, Date.parse('2026-11-12T03:00:00Z')).noSignal), 'Piyasa kapalı');
  const thin = { ...ch, calls: ch.calls.map(o => ({ ...o, bid: 1, ask: 2 })) };
  chk0('Likidite filtresi', String(SG.analyze('SPY', S, thin, bb, now, V1).noSignal), 'Likidite yetersiz (spread/hacim)');
  const flat = SG.analyze('SPY', S, ch, bb, now, { ...V1, minScore: 99 });
  ok('Zayıf puan → Sinyal yok + gerekçe', !flat.signal && /Puan zayıf/.test(flat.noSignal!));
  // v2 varsayılanları (backtest ile ayarlı)
  const v2 = SG.analyze('SPY', S, ch, bb, now);
  ok('v2: sinyal ya da gerekçeli ret', !!v2.signal || !!v2.noSignal);
  ok('v2: puan v1 ile aynı göstergelerden (decide = analyze)', SG.decide('SPY', S, ch, SG.features(S, ch, bb, now, 15), now, V1).score === r.score);
  const late2 = Date.parse('2026-11-11T17:35:00Z');
  chk0('v2: 12:30 ET sonrası yeni giriş yok', String(SG.analyze('SPY', S, ch, bars.filter(b => b.t <= late2), late2).noSignal), '12:30 ET sonrası yeni giriş yok');
  ok('v2: varsayılanlar daha seçici', SG.DEFAULT_OPTS.minScore > V1.minScore && SG.DEFAULT_OPTS.maxSpread < V1.maxSpread);
  const s0 = { ...sg, time: now, undTarget: S + 1, undStop: S - 1, dir: 'call' as const, dte: 0 };
  chk0('outcome hedef önce', SG.outcome(s0, [{ t: now + 60000, o: S, h: S + 1.2, l: S - 0.2, c: S + 1, v: 1 }], now + 120000).status, 'target');
  chk0('outcome aynı barda ikisi → stop', SG.outcome(s0, [{ t: now + 60000, o: S, h: S + 1.2, l: S - 1.2, c: S, v: 1 }], now + 120000).status, 'stop');
  chk0('outcome 15:30 sonrası süre doldu', SG.outcome(s0, [{ t: Date.parse('2026-11-11T20:45:00Z'), o: S, h: S, l: S, c: S, v: 1 }], Date.parse('2026-11-11T21:00:00Z')).status, 'expired');
}
// ===================== GÜNLÜK =====================
console.log('\n— Geçmiş / günlük —');
{
  const T = (ticker: string, entry: number, exit: number | undefined, qty = 1): J.Trade => ({ id: J.newId(), ticker, type: 'call', strike: 100, expiry: '2026-11-12', qty, entry, entryTime: 1, exit, exitTime: exit != null ? 2 : undefined });
  const ts = [T('SPY', 1, 1.5, 2), T('SPY', 2, 1), T('QQQ', 1, 3), T('QQQ', 1, undefined)];
  eq('Gerçekleşen P/L', J.realized(ts[0]), 100, 1e-9);
  eq('Açık P/L (canlı)', J.pnl(ts[3], 1.4), 40, 1e-9);
  const st = J.stats(ts);
  ok('İstatistik: 3 kapalı, 2 kazanç', st.n === 3 && st.wins === 2); eq('Kazanma oranı', st.winRate!, 2 / 3, 1e-9); eq('Toplam P/L', st.total, 200, 1e-9);
  chk0('Sembol bazında sıralı', J.byTicker(ts).map(x => x.ticker).join(','), 'QQQ,SPY');
  const csv = J.toCSV([{ ...ts[0], note: 'a,"b"' }]);
  ok('CSV başlık + kaçış', csv.startsWith('id,ticker,type') && csv.includes('"a,""b"""') && csv.includes(',100.00,'));
  const ss = J.signalStats([{ status: 'target' }, { status: 'stop' }, { status: 'target' }, { status: 'open' }] as J.SignalLog[]);
  ok('Sinyal isabet oranı', ss.resolved === 3 && Math.abs(ss.hitRate! - 2 / 3) < 1e-9);
}
// ===================== BİLDİRİM / UYARI / TABLO =====================
console.log('\n— Uyarılar, çıkış saati, günlük sınır, tablo —');
{
  const chkA = (name: string, got: unknown, exp: unknown) => { const g = JSON.stringify(got), e = JSON.stringify(exp); const ok = g === e; if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + ' = ' + g + (ok ? '' : ' (beklenen ' + e + ')')); };
  // 12 Kas 2026 (EST, UTC−5): 0DTE çıkış 15:30 ET = 20:30Z; diğer 15:45 ET = 20:45Z
  const t0 = Date.parse('2026-11-12T16:00:00Z');
  chkA('0DTE çıkış 15:30 ET', new Date(AL.exitAtMs(t0, 0)).toISOString(), '2026-11-12T20:30:00.000Z');
  chkA('1DTE çıkış 15:45 ET', new Date(AL.exitAtMs(t0, 1)).toISOString(), '2026-11-12T20:45:00.000Z');
  chkA('Yaz saati (EDT) 0DTE çıkış', new Date(AL.exitAtMs(Date.parse('2026-07-15T15:00:00Z'), 0)).toISOString(), '2026-07-15T19:30:00.000Z');
  chkA('ET saat metni', AL.etHM(AL.exitAtMs(t0, 0)), '15:30 ET');
  chkA('İstanbul saati (UTC+3)', AL.localHM(AL.exitAtMs(t0, 0), 180), '23:30');
  const tr: J.Trade = { id: 'x', ticker: 'SPY', type: 'call', strike: 600, expiry: '2026-11-12', qty: 1, entry: 2, entryTime: t0, target: 3, stop: 1.5, undTarget: 602, undStop: 599, undRef: 600 };
  chkA('Opsiyon fiyatı: yaklaştı (%75)', AL.checkLevels(tr, { opt: 2.8 }), ['nearTarget']);
  chkA('Opsiyon fiyatı: hedef', AL.checkLevels(tr, { opt: 3.1 }), ['target']);
  chkA('Opsiyon fiyatı: stop', AL.checkLevels(tr, { opt: 1.5 }), ['stop']);
  chkA('Opsiyon: stopa yaklaştı', AL.checkLevels(tr, { opt: 1.6 }), ['nearStop']);
  chkA('Tarafsız bölge → uyarı yok', AL.checkLevels(tr, { opt: 2.2 }), []);
  chkA('Gönderilmiş uyarı tekrar yok', AL.checkLevels({ ...tr, alerts: ['nearTarget'] }, { opt: 2.9 }), []);
  chkA('Hedef sonrası yaklaştı yok', AL.checkLevels({ ...tr, alerts: ['target'] }, { opt: 2.9 }), []);
  chkA('Dayanak (call) hedef', AL.checkLevels(tr, { und: 602.5 }), ['target']);
  chkA('Dayanak (put) stop', AL.checkLevels({ ...tr, type: 'put', undTarget: 598, undStop: 601 }, { und: 601.2 }), ['stop']);
  // günlük sınır: sembol başına 2 farklı kontrat
  const sg = (strike: number, dir = 'call', ticker = 'SPY', time = t0) => ({ ticker, dir, strike, expiry: '2026-11-12', time });
  const ex = [sg(600), sg(601, 'put')];
  chkA('3. farklı sinyal engellenir', AL.signalAllowed(ex, sg(602)), false);
  chkA('Aynı sinyal tekrar gelirse izin', AL.signalAllowed(ex, sg(600)), true);
  chkA('Başka sembol serbest', AL.signalAllowed(ex, sg(500, 'call', 'QQQ')), true);
  chkA('Ertesi gün sıfırlanır', AL.signalAllowed(ex, sg(602, 'call', 'SPY', t0 + 86400000)), true);
  // fiyat adımı ve tablo
  chkA('Hisse −/+ adımı 680 $ → 1', priceStep(680), 1); chkA('Hisse −/+ adımı 5 $ → 0,1', priceStep(5), 0.1);
  const r1 = tableRows(100, 105, [80, 120], { step: 1, pct: 5, lo: null, hi: null });
  chkA('Tablo ±%5 adım 1 → 95..105', [r1.prices[0], r1.prices[r1.prices.length - 1], r1.prices.length], [105, 95, 11]);
  const r2 = tableRows(100, 100, [80, 120], { step: 0.5, pct: null, lo: 98, hi: 102 });
  chkA('Tablo elle 98–102 adım 0,5', r2.prices.length, 9);
  const r3 = tableRows(100, 100, [0, 1000], { step: 0.5, pct: null, lo: null, hi: null });
  ok('Satır sınırı uygulanır', r3.capped && r3.prices.length <= MAX_ROWS + 3);
  const r4 = tableRows(100, 103.3, [90, 110], { step: 5, pct: null, lo: null, hi: null });
  ok('Hedef ve şimdi satırı eklenir', r4.prices.includes(103.3) && r4.prices.includes(100));
}
// Biçimlendirme / ayrıştırma
const chk = (name: string, got: unknown, exp: unknown) => { const ok = got === exp; if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + ' = ' + String(got) + ' (beklenen ' + String(exp) + ')'); };
chk('fmt 1234567,891', fmt(1234567.891, 2), '1.234.567,89');
chk('fmt -0,001 → 0,00', fmt(-0.001, 2), '0,00');
chk('parseNum "1.234,5"', parseNum('1.234,5'), 1234.5);
chk('parseNum "12,5 $"', parseNum('12,5 $'), 12.5);
chk('parseTrDate 13.11.2026', parseTrDate('13.11.2026'), '2026-11-13');
chk('parseTrDate 31.02.2026 geçersiz', parseTrDate('31.02.2026'), null);

// ——— strateji modülleri (saf fonksiyonlar) ———
{
  const q = (strike: number, delta: number, bid: number, ask: number, oi = 1000) => ({ type: 'call' as const, strike, bid, ask, last: (bid + ask) / 2, iv: 0.2, volume: 100, oi, delta });
  const ch = { expiry: '2026-11-13', calls: [q(99, 0.7, 2.0, 2.1), q(100, 0.52, 1.2, 1.25), q(101, 0.35, 0.6, 0.9), { ...q(102, 0.2, 0.3, 0.31, 0), volume: 0 }], puts: [] };
  const pk = STR.pickContract(ch, 'call', 100, { targetDelta: 0.5, maxSpread: 0.1, minVol: 50, minOI: 200 });
  chk('pickContract: delta 0,5 → 100C', pk?.strike, 100);
  chk('pickContract: geniş spread elenir (0,35 hedef → 101C değil)', STR.pickContract(ch, 'call', 100, { targetDelta: 0.35, maxSpread: 0.1, minVol: 50, minOI: 200 })?.strike, 100);
  chk('pickContract: likit kontrat yok → null', STR.pickContract(ch, 'put', 100, { targetDelta: 0.5, maxSpread: 0.1, minVol: 50, minOI: 200 }), null);
  const P = { ...STR.COMMON_DEFAULTS, startMin: 30, endMin: 300, skip: [[150, 240]] as [number, number][] };
  chk('inWindow 29 dk → hayır', STR.inWindow(29, P), false); chk('inWindow 60 dk → evet', STR.inWindow(60, P), true); chk('inWindow öğle (180) → hayır', STR.inWindow(180, P), false);
  const s = STR.strategyById('orb-vwap')!, w = STR.withTimeFilter(s, 15, 90, 'x');
  chk('withTimeFilter id', w.id, 'orb-vwap@x'); chk('withTimeFilter endMin', w.defaults.endMin, 90);
  ok('strateji kimlikleri tekil', new Set(STR.STRATEGIES.map(x => x.id)).size === STR.STRATEGIES.length);
  // em-breach: önceki kapanış 100, em0 1 → 100,9'da (k=0,8) call
  const em = STR.strategyById('em-breach')!;
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: i * 60000, o: 100 + i * 0.015, h: 100 + i * 0.015 + 0.02, l: 100 + i * 0.015 - 0.02, c: 100 + i * 0.015, v: 1000 }));
  const F: any = { vw: 100.4, mo: null, w: { callWall: null, putWall: null }, gx: { net: 0, flip: null }, em: { move: 1 }, orMinutes: 15 };
  const ctx = (S: number) => ({ ticker: 'X', S, t: 0, m: 60, bars, F, day: { ticker: 'X', date: '2026-11-12', dte: 0, prevClose: 100, openPx: 100, em0: 1 }, chain: () => ch, mem: {} });
  chk('em-breach 100,9 → call', em.evaluate(ctx(100.9), em.defaults)?.dir, 'call');
  chk('em-breach 100,5 → sinyal yok', em.evaluate(ctx(100.5), em.defaults), null);
}
console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nTüm testler geçti'); process.exit(fail ? 1 : 0);
