import * as BS from '../src/lib/bs.ts';
import * as St from '../src/lib/strategy.ts';
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
// Strateji testleri
const gl = { S: 100, r: 4.3, q: 0, today: '2026-11-12' }, exp = '2026-12-12';
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
// Kâr olasılığı: long stock ~ P(S_T > S0) lognormal
a = St.analyze([L('call', 1, 100, 0.000001)], gl);
const T = 30 / 365, s = .3, d2 = (Math.log(100 / 100) + (.043 - s * s / 2) * T) / (s * Math.sqrt(T));
eq('POP ~ N(d2)', a.pop, BS.ncdf(d2), 1e-5);
// Biçimlendirme / ayrıştırma
const chk = (name: string, got: unknown, exp: unknown) => { const ok = got === exp; if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + ' = ' + String(got) + ' (beklenen ' + String(exp) + ')'); };
chk('fmt 1234567,891', fmt(1234567.891, 2), '1.234.567,89');
chk('fmt -0,001 → 0,00', fmt(-0.001, 2), '0,00');
chk('parseNum "1.234,5"', parseNum('1.234,5'), 1234.5);
chk('parseNum "12,5 $"', parseNum('12,5 $'), 12.5);
chk('parseTrDate 13.11.2026', parseTrDate('13.11.2026'), '2026-11-13');
chk('parseTrDate 31.02.2026 geçersiz', parseTrDate('31.02.2026'), null);
console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nTüm testler geçti'); process.exit(fail ? 1 : 0);
