// Sonuç kartı (verdict) ve Fırsat dayanak seçimi (spot) saf testleri. Ağ YOK.
import * as V from '../src/lib/signals/verdict.ts';
import * as SP from '../src/lib/signals/spot.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const BASE: V.VerdictInputs = { S: 100, vwap: null, orHigh: null, orLow: null, flip: null, callWall: null, putWall: null, emMove: null,
  pcVol: null, unusualCall: 0, unusualPut: 0, momentum: null };
const sumOf = (i: V.VerdictInputs) => V.tally(V.criteria(i));

// ───── 1) Kriterler: işaret ve metin ─────
{
  const up: V.VerdictInputs = { ...BASE, vwap: 99, orHigh: 101, orLow: 98, flip: 98, pcVol: 0.5, unusualCall: 1000, unusualPut: 100, momentum: 1 };
  const t = V.tally(V.criteria(up));
  ok('yükseliş senaryosu: toplam +5 (orb içeride 0)', t.sum === 5, `sum=${t.sum}`);
  ok('yükseliş: yön CALL, güç 5', t.dir === 'call' && t.strength === 5, `${t.dir} ${t.strength}`);
  ok('yükseliş: yöne uyan 5 kriter listelenir', t.fired.length === 5, String(t.fired.length));
  ok('yükseliş: gerekçe metni (VWAP üstünde)', t.fired.some(c => c.text === 'VWAP üstünde'));
  const dn: V.VerdictInputs = { ...BASE, vwap: 101, orHigh: 102, orLow: 101, flip: 105, callWall: 101, emMove: 4, pcVol: 1.5,
    unusualCall: 10, unusualPut: 900, momentum: -1 };
  const d = V.tally(V.criteria(dn));
  ok('düşüş senaryosu: PUT, güç 5 (puan −7 → 5)', d.dir === 'put' && d.strength === 5 && d.sum === -7, `${d.dir} ${d.strength} ${d.sum}`);
}

// ───── 2) Eşik ve Bekle ─────
{
  ok('tümü veri yok → Bekle, güç 0', V.tally(V.criteria(BASE)).dir === 'bekle' && V.tally(V.criteria(BASE)).strength === 0);
  const two: V.VerdictInputs = { ...BASE, vwap: 99, flip: 98 };
  const t2 = V.tally(V.criteria(two));
  ok('puan +2 → Bekle (eşik 3), güç 2 gösterilir', t2.dir === 'bekle' && t2.strength === 2 && t2.sum === 2, JSON.stringify([t2.dir, t2.strength]));
  const three: V.VerdictInputs = { ...BASE, vwap: 99, flip: 98, momentum: 1 };
  ok('puan +3 → CALL (eşik tam 3)', V.tally(V.criteria(three)).dir === 'call');
  const minus3: V.VerdictInputs = { ...BASE, vwap: 101, flip: 102, momentum: -1 };
  ok('puan −3 → PUT', V.tally(V.criteria(minus3)).dir === 'put');
  ok('Bekle durumunda fired boş', V.tally(V.criteria(two)).fired.length === 0);
}

// ───── 3) Duvar yakınlığı (EM × 0,35) ─────
{
  const nearPut: V.VerdictInputs = { ...BASE, S: 100, putWall: 99, callWall: 130, emMove: 4 };       // 1/4 < 0,35 → destek
  const c1 = V.criteria(nearPut).find(c => c.id === 'wall')!;
  ok('put duvarı yakın → +1', c1.pts === 1, JSON.stringify(c1));
  const nearCall: V.VerdictInputs = { ...BASE, S: 100, putWall: 70, callWall: 101, emMove: 4 };
  ok('call duvarı yakın → −1', V.criteria(nearCall).find(c => c.id === 'wall')!.pts === -1);
  const far: V.VerdictInputs = { ...BASE, S: 100, putWall: 90, callWall: 115, emMove: 4 };         // 2,5 EM → uzak
  ok('duvarlar uzak → 0', V.criteria(far).find(c => c.id === 'wall')!.pts === 0);
  const both: V.VerdictInputs = { ...BASE, S: 100, putWall: 99, callWall: 101, emMove: 4 };
  ok('iki duvar da yakın → net 0', V.criteria(both).find(c => c.id === 'wall')!.pts === 0);
}

// ───── 4) Vade seçimi (Istanbul 16:30–20:00 penceresi) ─────
{
  const at = (iso: string) => Date.parse(iso);
  // 2026-11-16 (Pazartesi). EST: İst = ET+8. 16:30–20:00 İst = 08:30–12:00 ET → 13:30–17:00 UTC
  const inWin = at('2026-11-16T14:00:00Z');      // 17:00 İst
  const outWin = at('2026-11-16T20:00:00Z');     // 23:00 İst
  ok('İst dakika: 17:00 İst = 1020', V.istMinutes(inWin) === 1020, String(V.istMinutes(inWin)));
  ok('pencere: 17:00 İst içinde, 23:00 İst dışında', V.inZeroDteWindow(inWin) && !V.inZeroDteWindow(outWin));
  const opts = [{ date: '2026-11-16', dte: 0 }, { date: '2026-11-20', dte: 4 }, { date: '2026-11-23', dte: 7 }];
  ok('pencerede 0DTE seçilir', V.pickExpiry(opts, inWin)?.date === '2026-11-16');
  const noZero = [{ date: '2026-11-17', dte: 1 }, { date: '2026-11-20', dte: 4 }];
  ok('0DTE yok → en yakın 1 DTE', V.pickExpiry(noZero, inWin)?.dte === 1);
  ok('4+ DTE dışlanır; uygun yoksa null', V.pickExpiry([{ date: '2026-11-20', dte: 4 }], inWin) === null);
  ok('pencere dışında da en yakın (0DTE) — açık tasarım sorusu', V.pickExpiry(opts, outWin)?.date === '2026-11-16');
}

// ───── 5) Kural strike'ı (OTM, likidite, spread) ─────
{
  const q = (type: 'call' | 'put', strike: number, bid: number, ask: number, volume = 100, oi = 500) => ({ type, strike, bid, ask, volume, oi });
  const chain = [q('call', 580, 6, 6.2), q('call', 585, 1.15, 1.25), q('call', 590, 0.5, 0.56), q('call', 575, 9, 9.1),
    q('call', 586, 0, 1), q('call', 587, 0.3, 1.0), q('call', 588, 0.8, 0.84, 1, 1), q('put', 575, 1, 1.1)];
  const p = V.pickRuleStrike(chain, 580, 'call', 5);
  ok('hedef S+d=585 → 585C (OTM, mid 1,20)', p?.strike === 585 && Math.abs((p?.mid ?? 0) - 1.2) < 1e-9, JSON.stringify(p));
  ok('ITM strike (580, 575) seçilmez', p?.strike !== 580 && p?.strike !== 575);
  ok('geniş spread (587: %99+) ve bid=0 elenir', V.pickRuleStrike([q('call', 587, 0.3, 1.0), q('call', 586, 0, 1)], 580, 'call', 6) === null);
  ok('hacim/OI düşük (588) elenir', V.pickRuleStrike([q('call', 588, 0.8, 0.84, 1, 1)], 580, 'call', 8) === null);
  const pp = V.pickRuleStrike([q('put', 575, 1, 1.1), q('put', 570, 0.5, 0.55)], 580, 'put', 5);
  ok('put: hedef S−d=575 → 575P', pp?.strike === 575, JSON.stringify(pp));
}

// ───── 6) Prim seviyeleri (−%40 stop, 1:5 ve 1:4) ─────
{
  const L = V.levelsFor(1.20)!;
  ok('giriş 1,20 → stop 0,72 (0,60×)', L.stop === 0.72, String(L.stop));
  ok('hedef 1:5 = 3,60', L.t5 === 3.6, String(L.t5));
  ok('yedek 1:4 = 3,12', L.t4 === 3.12, String(L.t4));
  ok('kontrat riski $48', L.riskPerContract === 48, String(L.riskPerContract));
  const K = V.levelsFor(3.00)!;
  ok('Kaan örneği 3,00 → stop 1,80, hedef 9,00, yedek 7,80, risk $120', K.stop === 1.8 && K.t5 === 9 && K.t4 === 7.8 && K.riskPerContract === 120, JSON.stringify(K));
  ok('çok ucuz prim (<0,05) → null', V.levelsFor(0.04) === null);
}

// ───── 7) Tam kart: örnek gerekçe ve kademe/adet ─────
{
  const inWin = Date.parse('2026-11-16T14:00:00Z');
  const inputs: V.VerdictInputs = { ...BASE, S: 580, vwap: 579, flip: 578, pcVol: 0.5, unusualCall: 900, unusualPut: 100 };
  const quotes = [{ type: 'call' as const, strike: 585, bid: 1.15, ask: 1.25, volume: 200, oi: 900 }];
  const card = V.buildVerdict({ inputs, expiries: [{ date: '2026-11-16', dte: 0 }], nowMs: inWin,
    quotesFor: () => quotes, dOf: () => 5, kademe: 0.5, capital: 300 });
  ok('kart: CALL, güçlü (4/5)', card.dir === 'call' && card.strength === 4, `${card.dir} ${card.strength}`);
  ok('kart gerekçesi: örnek biçim', card.rationale.startsWith('CALL, güçlü (4/5): ') && card.rationale.endsWith('giriş 1,20 stop 0,72 hedef 3,60'), card.rationale);
  ok('kart: strike 585, 0DTE', card.strike === 585 && card.dte === 0, JSON.stringify([card.strike, card.dte]));
  ok('kart: kademe %50 × 300 $ → 1 kontrat (1,20×100+1,50 = 121,5; bütçe 150)', card.contracts === 1 && card.tierPct === 50, JSON.stringify([card.contracts, card.tierPct]));
  ok('kart: hedef ve stop seviyeleri dolu (stop 0,72, 1:5 3,60, 1:4 3,12)', card.t5 === 3.6 && card.stop === 0.72 && card.t4 === 3.12);
  const bek = V.buildVerdict({ inputs: BASE, expiries: [{ date: '2026-11-16', dte: 0 }], nowMs: inWin, quotesFor: () => quotes, dOf: () => 5 });
  ok('Bekle: rasyonel metin, giriş yok', bek.dir === 'bekle' && bek.entry === null && bek.rationale.startsWith('Bekle: yön yok'), bek.rationale);
  const noChain = V.buildVerdict({ inputs, expiries: [{ date: '2026-11-16', dte: 0 }], nowMs: inWin, quotesFor: () => null, dOf: () => 5 });
  ok('zincir yok → yön var, strike yok, açıklama', noChain.dir === 'call' && noChain.strike === null && /uygun strike/.test(noChain.rationale));
  ok('kart notu: kağıt üstü / tavsiye değildir', /tavsiye değildir/.test(card.note));
}

// ───── 8) Dayanak fiyat seçimi (spot) ─────
{
  const now = Date.parse('2026-11-16T15:00:00Z');
  const quote = { price: 580, delayedMin: 15 };
  const fresh = SP.spotPrice(quote, { t: now - 120000, c: 581.5 }, now);          // bar başlangıcı 2 dk önce → kapanış 1 dk önce
  ok('taze bar → bar fiyatı, gecikme 0', fresh.source === 'bar' && fresh.price === 581.5 && fresh.delayedMin === 0 && fresh.ageSec === 60, JSON.stringify(fresh));
  const stale = SP.spotPrice(quote, { t: now - 600000, c: 579 }, now);
  ok('bar 9 dk eski → kotasyon (15 dk gecikme etiketiyle)', stale.source === 'quote' && stale.price === 580 && stale.delayedMin === 15);
  const none = SP.spotPrice(quote, null, now);
  ok('bar yok → kotasyon', none.source === 'quote' && none.ageSec === null);
  const bad = SP.spotPrice(quote, { t: now - 60000, c: 0 }, now);
  ok('sıfır kapanış (bozuk bar) → kotasyon', bad.source === 'quote');
}

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\nverdict/spot testleri tamam');
