import * as P from '../src/lib/prob/implied.ts';
import * as BS from '../src/lib/bs.ts';
import * as CB from '../src/lib/market/cboe.ts';
import type { Chain } from '../src/lib/market/types.ts';
// @ts-ignore — Node yerleşik modülü (test yalnızca Node'da çalışır)
import { readFileSync } from 'node:fs';
let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };
const eq = (name: string, got: number, exp: number, tol: number) => ok(name, Math.abs(got - exp) <= tol, `= ${got.toFixed(6)} (beklenen ${exp}, tol ${tol})`);

console.log('\n— Olasılık motoru (Aşama A) —');
const S = 100, T = 0.5, r = 0.04, q = 0.01;
const strikes = Array.from({ length: 41 }, (_, i) => 60 + i * 2); // 60..140

// 1) Düz IV → pAbove = N(d2) (1e-9)
const flat = P.makeSmile(S, T, r, q, strikes.map(K => ({ K, iv: 0.3 })));
for (const K of [80, 95, 100, 105, 120]) {
  const sT = 0.3 * Math.sqrt(T), d2 = (Math.log(S / K) + (r - q - 0.3 * 0.3 / 2) * T) / sT;
  eq(`düz IV pAbove(${K}) = N(d2)`, P.pAbove(flat, K), BS.ncdf(d2), 1e-9);
}

// 2) Skew'li smile: pAbove K arttıkça artmaz, [0,1] aralığında
const skewed = P.makeSmile(S, T, r, q, strikes.map(K => ({ K, iv: 0.25 + 0.002 * (100 - K) })));
let mono = true, inRange = true, prev = Infinity;
for (let K = 80; K <= 120; K += 1) {
  const p = P.pAbove(skewed, K);
  if (p > prev + 1e-12) mono = false;
  if (!(p >= 0 && p <= 1)) inRange = false;
  prev = p;
}
ok('skew: pAbove K arttıkça artmaz (80..120)', mono);
ok('skew: pAbove [0,1] içinde', inRange);

// 3) Gerçek zincir (CBOE AAPL fikstürü): pAbove(F) ≈ 0,5 ± 0,08; çapraz kontrol ± 0,05
const fx = JSON.parse(readFileSync(new URL('./fixtures/cboe-AAPL.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-12T18:00:00Z');
const quote = CB.parseCboeQuote(fx, 'AAPL', now);
const chains = CB.parseCboeChains(fx, 'AAPL', now);
const exp = [...chains.keys()].sort().find(e => Date.parse(e + 'T21:00:00Z') - now > 7 * 864e5)!;
const Tf = (Date.parse(exp + 'T21:00:00Z') - now) / (365 * 864e5);
const ch = chains.get(exp) as Chain;
const sm = P.buildSmile(ch, quote.price, Tf, 0.04, 0.005);
ok('fikstür: smile en az 5 nokta', sm.pts.length >= 5, `(${sm.pts.length} nokta, vade ${exp})`);
eq('fikstür: pAbove(F) ≈ 0,5', P.pAbove(sm, sm.F), 0.5, 0.08);
for (const K of [quote.price * 0.98, quote.price * 1.02]) {
  const cc = P.crossCheck(ch, K, Tf, 0.04);
  ok(`fikstür: çapraz kontrol K=${K.toFixed(2)} mevcut`, cc !== null);
  if (cc !== null) eq(`fikstür: |pAbove − çapraz| K=${K.toFixed(2)}`, Math.abs(P.pAbove(sm, K) - cc), 0, 0.05);
}

// 4) Olasılık tutarlılığı: pBetween + pBelow(K1) + pAbove(K2) = 1; dokunma ≥ kapanış olasılığı
const K1 = 95, K2 = 110;
eq('pBetween toplam = 1', P.pBetween(skewed, K1, K2) + P.pBelow(skewed, K1) + P.pAbove(skewed, K2), 1, 1e-12);
ok('pTouch(115) ≥ pAbove(115) ve ≤ 1', P.pTouch(skewed, 115) >= P.pAbove(skewed, 115) && P.pTouch(skewed, 115) <= 1);
ok('pTouch(85) ≥ pBelow(85) ve ≤ 1', P.pTouch(skewed, 85) >= P.pBelow(skewed, 85) && P.pTouch(skewed, 85) <= 1);

// 5) Kantiller: pAbove(q(p)) = 1−p; sıralı
for (const p of [0.1, 0.5, 0.9]) eq(`quantile(${p}) geri doğrulama`, P.pAbove(skewed, P.quantile(skewed, p)), 1 - p, 1e-6);
ok('quantile 0,1 < 0,5 < 0,9', P.quantile(skewed, 0.1) < P.quantile(skewed, 0.5) && P.quantile(skewed, 0.5) < P.quantile(skewed, 0.9));

// 6) Skew metrikleri: put skew → RR25 > 0, put kanadı eğimi > 0; 25Δ strike'lar smile-tutarlı delta verir
const sk = P.skew(skewed);
ok('RR25 > 0 (put skew)', sk.rr25 > 0, `(${sk.rr25.toFixed(4)})`);
ok('put kanadı eğimi > 0', sk.putWing > 0, `(${sk.putWing.toFixed(4)})`);
ok('25Δ put K < F < 25Δ call K', sk.k25P < skewed.F && skewed.F < sk.k25C);
eq('25Δ call delta = 0,25', BS.greeks('call', S, sk.k25C, T, r, q, sk.iv25C).delta, 0.25, 1e-4);
eq('25Δ put delta = −0,25', BS.greeks('put', S, sk.k25P, T, r, q, sk.iv25P).delta, -0.25, 1e-4);

// 7) Filtre: bid=0, geniş spread, düşük mid, ITM taraf dışarıda; iv=null → impliedVol ile dahil
const syn: Chain = {
  expiry: '2026-12-18', puts: [
    { type: 'put', strike: 95, bid: 1, ask: 1.1, last: 1, iv: 0.29, volume: 1, oi: 1 },
    { type: 'put', strike: 105, bid: 3, ask: 3.1, last: 3, iv: 0.3, volume: 1, oi: 1 }, // F üstü put → ITM, dışarıda
  ], calls: [
    { type: 'call', strike: 105, bid: 1, ask: 1.1, last: 1, iv: 0.3, volume: 1, oi: 1 },
    { type: 'call', strike: 110, bid: 0, ask: 0.5, last: 0.3, iv: 0.5, volume: 0, oi: 0 },   // bid=0
    { type: 'call', strike: 115, bid: 0.01, ask: 0.2, last: 0.1, iv: 0.4, volume: 0, oi: 0 }, // geniş spread
    { type: 'call', strike: 120, bid: 0.01, ask: 0.02, last: 0.01, iv: 0.6, volume: 0, oi: 0 }, // mid < 0,05
    { type: 'call', strike: 125, bid: 0.5, ask: 0.6, last: 0.5, iv: 0.32, volume: 1, oi: 1 },
    { type: 'call', strike: 130, bid: 0.5, ask: 0.6, last: 0.5, iv: null, volume: 1, oi: 1 }, // iv yok → impliedVol
  ],
};
const fs = P.buildSmile(syn, 100, 0.25, 0.04, 0);
ok('filtre: noktalar [95,105,125,130]', JSON.stringify(fs.pts.map(p => p.K)) === '[95,105,125,130]', JSON.stringify(fs.pts.map(p => p.K)));
ok('filtre: iv=null noktası geçerli IV', isFinite(fs.pts[3].iv) && fs.pts[3].iv > 0.001, `(${fs.pts[3].iv.toFixed(4)})`);

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nOlasılık testleri geçti'); process.exit(fail ? 1 : 0);
