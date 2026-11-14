/* Fırsat Aşama 5 testleri: kart (skor, RR 1:N, mod uygunluğu, boyut, vetolar, metin), pozisyon adımı (hedef, stop, uyarı, 15:45, gece, gap). Ağ yok. */
import { normCdf, pTouchApprox, minRrFor, buildOpp, trNum, type OppInput } from '../src/lib/signals/opp.ts';
import { initAccount, openPosition, type OpenInput } from '../src/lib/paper/account.ts';
import { tickPosition, outcomeOf, type TickIn } from '../src/lib/paper/engine.ts';
import { TRIGGER_AD } from '../src/lib/signals/riskwatch.ts';
import type { StrikePick } from '../src/lib/signals/strikes.ts';
import type { RRResult } from '../src/lib/signals/rr.ts';
import type { PaperAccount } from '../src/lib/paper/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- yardımcılar
const rr = (over: Partial<RRResult> = {}): RRResult => ({ entry: 1, primStop: 0.3, primTarget: 5.2, risk: 0.7, reward: 4.2, rr: 5.2,
  tauTargetMin: 60, valid: true, ...over });
const pick = (rrOver: Partial<RRResult> = {}): StrikePick => ({ strike: 100, delta: 0.35, rr: rr(rrOver), dRule: { strike: 100, rr: null }, skipped: [] });
const base = (over: Partial<OppInput> = {}): OppInput => ({
  ticker: 'QQQ', setup: 'S1', dir: 'bull', pick: pick(), spot: 100, und: { entry: 100, stop: 98, target: 102 }, reasons: ['QQQ ve SPY VWAP üstünde'],
  em: 2.5, emRemain: 2, expiry: '2026-11-13', dte: 0, etMin: 600, leftMin: 210, marketOpen: true, now: 1, delayedMin: 0,
  barAgeSec: 5, chainAgeSec: 10,
  regime: { vwapAll: true, orAll: true, opposite: false }, sector: { present: true, vwapOk: true }, frames: 3, volRatio: 2.5,
  radar: { same: 0.8, oppMax: 0 }, maxSpreadPct: 5, spreadPct: 2, liquid: true,
  account: { mode: 'AGRESIF', capital: 300, kademe: 0.5, commission: 1.5, fractional: false }, ttlMin: 3,
  quote: { bid: 0.98, ask: 1.0, iv: 0.3 }, ...over,
});

// ---- olasılık ve eşikler
ok('normCdf(0) = 0,5', near(normCdf(0), 0.5, 1e-6));
ok('normCdf(1,96) ≈ 0,975', near(normCdf(1.96), 0.975, 1e-3));
ok('normCdf(−1) ≈ 0,1587', near(normCdf(-1), 0.1587, 1e-3));
ok('pTouch: gereken 0 → 1', near(pTouchApprox(0, 1), 1, 1e-6));
ok('pTouch: gereken = 1 EM → ≈ 0,317', near(pTouchApprox(1, 1), 0.3173, 1e-3));
ok('pTouch: EM 0 → 0', pTouchApprox(1, 0) === 0);
ok('minRr: AGRESIF 4 (1:4 dâhil), güvenli 1,5, DURDU yok', minRrFor('AGRESIF') === 4 && minRrFor('GUVENLI_KAR') === 1.5 && minRrFor('DURDU') === Infinity);
ok('Türkçe sayı: 1,25', trNum(1.25, 2) === '1,25');

// ---- kart: uygun 1:5 (AGRESIF)
{
  const c = buildOpp(base());
  ok('kart: RR = 1:5,2 (çıkış/giriş)', near(c.rr, 5.2));
  ok('kart: giriş = dolum (ask+kayma, RR girişi)', near(c.fill, 1));
  ok('kart: stop prim ≥ −%40 tavanı (0,60)', c.stopPrem >= 0.6 - 1e-9, String(c.stopPrem));
  ok('kart: skor 0–100 ve etiket', c.score >= 0 && c.score <= 100 && ['Zayıf', 'Orta', 'İyi', 'Güçlü'].includes(c.label), String(c.score));
  ok('kart: uygun (1:5, skor ≥ 65, kontrat 1 adet)', c.eligible && c.mode === 'AGRESIF', `${c.eligible} ${c.mode} ${c.reason} skor ${c.score} ${c.vetoes}`);
  ok('kart: kademe %50 bütçe 150, 1 kontrat', c.sizing !== null && c.sizing.budget === 150 && c.sizing.contracts === 1, JSON.stringify(c.sizing));
  ok('kart: metin Başkan diliyle ve 1:5,2 yazar', c.text.body.startsWith('Başkan,') && c.text.body.includes('RR 1:5,2'));
  ok('kart: 0DTE gece taşınmaz', c.overnightOk === false);
  // D12: risk bazlı hedef = giriş + N × risk (1:5 → giriş + 5 × (giriş − stop))
  ok('kart: hedef = giriş + 5 × risk (risk bazlı 1:5)', near(c.primTarget, c.fill + 5 * (c.fill - c.stopPrem), 1e-9), `${c.primTarget} ${c.fill} ${c.stopPrem}`);
  ok('kart: 1:4 modunda hedef = giriş + 4 × risk', (() => { const d = buildOpp(base({ pick: pick({ rr: 4.2, primTarget: 4.2 }) })); return near(d.primTarget, d.fill + 4 * (d.fill - d.stopPrem), 1e-9); })());
}
// 1:4 (AGRESIF_4)
{
  const c = buildOpp(base({ pick: pick({ rr: 4.2, primTarget: 4.2 }) }));
  ok('kart: 1:5 yok, 1:4,2 → AGRESIF_4 uygun', c.mode === 'AGRESIF_4' && c.eligible, `${c.mode} ${c.eligible} ${c.reason} ${c.vetoes}`);
}
// 1:3 → giriş yok
{
  const c = buildOpp(base({ pick: pick({ rr: 3, primTarget: 3 }) }));
  ok('kart: 1:3 Agresif modda uygun değil (veto RR < 4)', c.eligible === false && c.vetoes.some(v => v.startsWith('RR')), `${c.vetoes}`);
}
// vetolar
{
  const c = buildOpp(base({ marketOpen: false }));
  ok('veto: piyasa kapalı → skor 0, uygun değil', c.score === 0 && !c.eligible && c.vetoes.includes('piyasa kapalı'));
}
{
  const c = buildOpp(base({ account: { mode: 'DURDU', capital: 300, kademe: 0.5, commission: 1.5, fractional: false } }));
  ok('DURDU: kart uygun değil', c.eligible === false);
}
{
  const c = buildOpp(base({ account: { mode: 'AGRESIF', capital: 100, kademe: 0.3, commission: 1.5, fractional: false } }));
  ok('sermaye yetersiz: kontrat 101,5 > bütçe 30 → uygun değil', c.eligible === false && c.vetoes.includes('sermaye yetersiz'), `${c.reason} ${c.vetoes}`);
}
// 0DTE dışı: gece taşınabilir
ok('1DTE kart: gece taşınabilir işareti', buildOpp(base({ dte: 1 })).overnightOk === true);
ok('TRIGGER_AD: T1 = ters mum', TRIGGER_AD.T1 === 'ters mum');

// ---- pozisyon adımı
const D = '2026-11-13';
const NOCOST = { commission: 0, slippage: 0, fractional: true };
function openAt(acc: PaperAccount, over: Partial<OpenInput> = {}): PaperAccount {
  const r = openPosition(acc, { id: 'p1', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: D, dte: 0, strike: 100, fill: 1,
    stopPrem: 0.6, targetPrem: 3, targetR: 3, mode: 'AGRESIF', now: 0, day: D, und: { entry: 100, stop: 98, target: 104 }, ...over });
  if (!r.ok) throw new Error(r.reason);
  return r.acc;
}
const tk = (over: Partial<TickIn> = {}): TickIn => ({ day: D, now: 1, etMin: 600, bid: 1, flags: {}, S: 100, ivAtm: 0.2,
  calendar: { ok: true, reasons: [] }, strongTriggerLast30: false, regimeAligned: true, ...over });

{
  const r = tickPosition(openAt(initAccount(300, NOCOST, D)), tk({ bid: 3 }));
  ok('pozisyon: hedef bid 3 → kapanır, +300', r.acc.position === null && near(r.acc.capital, 600) && r.events[0]?.kind === 'close', JSON.stringify(r.events.map(e => e.text)));
}
{
  const r = tickPosition(openAt(initAccount(300, NOCOST, D)), tk({ bid: 0.6 }));
  ok('pozisyon: stop (giriş × 0,60 = 0,60, −%40) → kapanır, 1,5 kontrat × −40 = −60', r.acc.position === null && near(r.acc.capital, 240) && r.events[0].trade?.reason === 'stop', String(r.acc.capital));
}
{
  const r = tickPosition(openAt(initAccount(300, NOCOST, D)), tk({ bid: null }));
  ok('pozisyon: bid yok → karar yok', r.acc.position !== null && r.events.length === 0);
}
{
  // R 1,5 (1R = 0,40) + güçlü tetik → uyarı; sonra 1,4 + tetik → çıkış
  let acc = openAt(initAccount(300, NOCOST, D));
  const r1 = tickPosition(acc, tk({ bid: 1.6, flags: { T2: true } }));
  ok('risk: 1,5R + güçlü tetik → uyarı, stop girişe', r1.events[0]?.kind === 'warn' && r1.acc.position!.warned === true && near(r1.acc.position!.stopPrem, 1));
  const r2 = tickPosition(r1.acc, tk({ bid: 1.56, flags: { T2: true } }));
  ok('risk: ikinci tetikte çıkış (risk)', r2.acc.position === null && r2.events[0].trade?.reason === 'risk');
}
{
  const r = tickPosition(openAt(initAccount(300, NOCOST, D), { dte: 0 }), tk({ etMin: 945, bid: 1.2 }));
  ok('0DTE: 15:45 ET zorunlu çıkış', r.acc.position === null && r.events[0].trade?.reason === 'zaman');
}
{
  // 2DTE gece kararı: kötü senaryo ≤ 1,5R → taşınır. R artık giriş × 0,40 (−%40 stop); aynı kötü senaryo $ kaybı R'yi daha çok aşar.
  // openAt 1,5 kontratlık (kesirli) pozisyon açar: 1R = 60 $; kötü senaryo ≈ 150 $ → 2,5R > 1,5R → taşınmaz.
  const acc = openAt(initAccount(300, NOCOST, D), { dte: 2, expiry: '2026-11-18' });
  const r = tickPosition(acc, tk({ etMin: 945, bid: 1.0 }));
  ok('gece: 2DTE kötü senaryo 2,5R > 1,5R → taşınmaz (gece-kapanis)', r.acc.position === null && r.acc.trades.at(-1)?.reason === 'gece-kapanis', JSON.stringify(r.events.map(e => e.text)));
  ok('gece: aynı gün ikinci kararda çift işlem yok', tickPosition(r.acc, tk({ etMin: 950, bid: 1.0 })).events.length === 0);
}
{
  // gece taşınan pozisyon: ertesi sabah gap (açılış stop altında) → gap çıkışı
  const acc0 = openAt(initAccount(300, NOCOST, D), { dte: 2, expiry: '2026-11-18' });
  const carried = { ...acc0, position: { ...acc0.position!, overnight: true } };
  const r = tickPosition(carried, tk({ day: '2026-11-16', etMin: 575, bid: 0.9, openUnd: 97, openBid: 0.9 }));
  ok('gap: açılış dayanak stopunun altında → gap çıkışı', r.acc.position === null && r.events[0]?.trade?.reason === 'gap' && r.events[0].trade?.gap === true);
}
{
  const acc0 = openAt(initAccount(300, NOCOST, D), { dte: 2, expiry: '2026-11-18' });
  const carried = { ...acc0, position: { ...acc0.position!, overnight: true } };
  const r = tickPosition(carried, tk({ day: '2026-11-16', etMin: 560, bid: 0.9, openUnd: 101, openBid: 0.9 }));
  ok('gap: 09:31 öncesi karar yok', r.acc.position !== null && r.events.length === 0);
}
{
  // 15:45'te hedef veya stop, gece taşımanın önüne geçer
  const acc = openAt(initAccount(300, NOCOST, D), { dte: 2, expiry: '2026-11-18', targetPrem: 3 });
  const r = tickPosition(acc, tk({ etMin: 945, bid: 3 }));
  ok('15:45 2DTE hedefte: taşınmaz, hedefle kapanır', r.acc.position === null && r.events[0]?.trade?.reason === 'hedef', JSON.stringify(r.events.map(e => e.kind + ':' + e.trade?.reason)));
}
{
  const acc = openAt(initAccount(300, NOCOST, D), { dte: 2, expiry: '2026-11-18' });
  const r = tickPosition(acc, tk({ etMin: 945, bid: 0.6 }));
  ok('15:45 2DTE stopta (0,60, −%40): taşınmaz, stopla kapanır', r.acc.position === null && r.events[0]?.trade?.reason === 'stop', JSON.stringify(r.events.map(e => e.kind + ':' + e.trade?.reason)));
}
ok('outcome: hedef → hedef, stop/gap → stop, gece/zaman → zaman', outcomeOf('hedef') === 'hedef' && outcomeOf('gap') === 'stop' && outcomeOf('gece-kapanis') === 'zaman');
ok('tetik adları Türkçe', TRIGGER_AD.T2 === 'VWAP kaybı');

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nFırsat Aşama 5 testleri geçti'); process.exit(fail ? 1 : 0);
