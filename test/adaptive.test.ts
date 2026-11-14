// Uyarlanabilir çıkış (adaptive.ts), riskwatch öncelik sırası ve rejim histerezisi (regime.ts hystConfirm). Sentetik 1 dk barlar; ağ YOK.
import * as AD from '../src/lib/signals/adaptive.ts';
import * as RW from '../src/lib/signals/riskwatch.ts';
import * as RG from '../src/lib/market/regime.ts';
import type { OpenPosition } from '../src/lib/paper/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const SS = Date.parse('2026-11-12T14:30:00Z');   // 09:30 ET (kış dışı: 12/11 EST = 14:30Z)
const MIN = 60000;
const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i + 1) / n);
function tape(prices: number[], vol: (i: number) => number = () => 1000): RG.TapeBar[] {
  return prices.map((c, i) => { const o = i ? prices[i - 1] : c; return { t: SS + i * MIN, o, h: Math.max(o, c) + 0.02, l: Math.min(o, c) - 0.02, c, v: vol(i) }; });
}
const now = (b: RG.TapeBar[]) => SS + b.length * MIN;

// ───── 1) Gerçek dönüş → ÇIK (call; 30. dk girişten sonra 0,6% ters hareket, VWAP kaybı, hacimli ters mum, momentum ters) ─────
{
  const b = tape([500, ...lin(500, 501, 29), ...lin(501, 503, 20), ...lin(503, 500.8, 15)], i => (i >= 30 && i < 50 ? 2000 : 1000));
  const l = b[b.length - 1];
  b[b.length - 1] = { ...l, o: 501.2, c: 500.0, h: 501.25, l: 499.95, v: 6000 };
  const d = AD.adaptiveDecision({ dirSign: 1, entryT: SS + 30 * MIN, nowMs: now(b), bars: b, regime: null });
  ok('gerçek dönüş → ÇIK', d.verdict === 'CIK', `${d.verdict} ${d.reason}`);
  ok('gerçek dönüş: VWAP kaybı + hacimli ters mum dönüş kanıtı', d.revSig.includes('VWAP kaybı') && d.revSig.includes('hacimli ters mum'), d.revSig.join(','));
  ok('gerçek dönüş: neden satırı ÇIK ile başlar ve devam kanıtını söyler', d.reason.startsWith('ÇIK: ') && d.reason.includes('devam kanıtı zayıf'), d.reason);
  ok('gerçek dönüş: karşı hareket ≥ %0,3', d.counterPct >= AD.ADAPT.COUNTER_PCT, String(d.counterPct));
}
// ───── 2) Trendde geri çekilme → TUT (call; VWAP üstünde, onaylı yükseliş rejimi; karşı hareket %0,36) ─────
{
  const b = tape([500, ...lin(500, 505, 40), ...lin(505, 502.9, 8), ...lin(502.9, 503.2, 6)]);
  const d = AD.adaptiveDecision({ dirSign: 1, entryT: SS, nowMs: now(b), bars: b, regime: 'trend_up' });
  ok('geri çekilme trendde → TUT (çıkış yok)', d.verdict === 'TUT', `${d.verdict} ${d.reason}`);
  ok('geri çekilme: VWAP doğru tarafta + rejim lehte devam kanıtı', d.contSig.includes('VWAP doğru tarafta') && d.contSig.includes('onaylı rejim lehte'), d.contSig.join(','));
  ok('geri çekilme: neden satırı TUT ile başlar', d.reason.startsWith('TUT: '), d.reason);
}
// ───── 3) Eşitlik → DİKKAT (15 dk seans; VWAP kaybı 2 puan vs hacimli trend mumu + rejim lehte 2 puan) ─────
{
  const b = tape([500, ...lin(500, 502, 8), ...lin(502, 500.6, 5), 500.45]);
  const l = b[b.length - 1];
  b[b.length - 1] = { ...l, o: 499.9, h: 500.5, l: 499.85, c: 500.45, v: 5000 };
  const d = AD.adaptiveDecision({ dirSign: 1, entryT: SS, nowMs: now(b), bars: b, regime: 'donus_up' });
  ok('eşit kanıt → DİKKAT (izle, çıkış yok)', d.verdict === 'DIKKAT' && d.rev === d.cont, `${d.verdict} ${d.rev}/${d.cont}`);
  ok('DİKKAT nedeni: iki tarafın puanı yazılır', d.reason.startsWith('DİKKAT: ') && d.reason.includes('ters 2 / devam 2'), d.reason);
}
// ───── 4) Karşı hareket < %0,3 → YOK (karar verilmez) ─────
{
  const b = tape([500, ...lin(500, 503, 30), ...lin(503, 502.5, 5)]);
  const d = AD.adaptiveDecision({ dirSign: 1, entryT: SS, nowMs: now(b), bars: b, regime: 'donus_down' });
  ok('karşı hareket %0,3 altı → YOK', d.verdict === 'YOK' && d.counterPct < AD.ADAPT.COUNTER_PCT, `${d.verdict} ${d.counterPct}`);
}
// ───── 5) Put: aynı mantık aynalı (yükseliş dönüşü → ÇIK) ─────
{
  const b = tape([500, ...lin(500, 499, 29), ...lin(499, 497, 20), ...lin(497, 499.2, 15)], i => (i >= 30 && i < 50 ? 2000 : 1000));
  const l = b[b.length - 1];
  b[b.length - 1] = { ...l, o: 498.8, c: 500.0, h: 500.05, l: 498.75, v: 6000 };
  const d = AD.adaptiveDecision({ dirSign: -1, entryT: SS + 30 * MIN, nowMs: now(b), bars: b, regime: null });
  ok('put: aşağı hareket lehte, yukarı dönüş → ÇIK', d.verdict === 'CIK' && d.revSig.includes('hacimli ters mum'), `${d.verdict} ${d.reason}`);
}

// ───── 6) Riskwatch: sert %67 stop her zaman önce; ÇIK kâr düzeyinden bağımsız çıkarır; TUT/DİKKAT çıkarmaz ─────
const pos = (over: Partial<OpenPosition> = {}): OpenPosition => ({
  id: 'p', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: '2026-11-12', dte: 0, strike: 100, contracts: 1.5, fill: 1, costBasis: 150,
  openComm: 0, stopPrem0: 1 / 3, stopPrem: 1 / 3, targetPrem: 3, rPrice: 2 / 3, rDollars: 100, targetR: 3, openedAt: 0, day: '2026-11-12',
  mode: 'AGRESIF', kademe: 0.5, overnight: false, maxR: 0, warned: false, ...over,
});
const adv = (verdict: AD.AdaptVerdict, reason = 'test'): AD.AdaptiveDecision =>
  ({ verdict, counterPct: 0.5, rev: verdict === 'CIK' ? 5 : 0, cont: verdict === 'TUT' ? 3 : 0, revSig: [], contSig: [], regimeAgainst: false, reason });
const T = (bid: number, a: AD.AdaptiveDecision | null, flags: Record<string, boolean> = {}) => ({ bid, etMin: 600, mode: 'AGRESIF' as const, flags: flags as any, adaptive: a });
{
  const d = RW.evaluatePosition(pos(), T(0.3, adv('CIK', 'ÇIK: test')));
  ok('öncelik: %67 stop ÇIK\'ın önünde (stop nedeni)', d.action === 'close' && d.reason === 'stop', `${d.action} ${d.reason}`);
  const h = RW.evaluatePosition(pos(), T(3.1, adv('CIK', 'ÇIK: test')));
  ok('öncelik: hedef ÇIK\'ın önünde', h.action === 'close' && h.reason === 'hedef');
  const c = RW.evaluatePosition(pos(), T(1.2, adv('CIK', 'ÇIK: VWAP kaybı; devam kanıtı zayıf')));
  ok('ÇIK kârda/zararda çıkarır (1,2 → kâr 0,3R)', c.action === 'close' && c.reason === 'risk' && c.message === 'ÇIK: VWAP kaybı; devam kanıtı zayıf', `${c.action} ${c.message}`);
  const tut = RW.evaluatePosition(pos(), T(1.2, adv('TUT'), { T1: true, T2: true, T3: true }));
  ok('TUT: eski T1/T2/T3 bayrakları yok sayılır → çıkış yok', tut.action === 'hold', tut.action);
  const dk = RW.evaluatePosition(pos(), T(1.2, adv('DIKKAT', 'DİKKAT: eşit')));
  ok('DİKKAT: çıkış yok, mesaj taşır', dk.action === 'hold' && dk.message === 'DİKKAT: eşit', `${dk.action} ${dk.message}`);
  ok('adaptive durumu pozisyona yazılır', tut.pos.adaptive === 'TUT' && c.pos.adaptive === 'CIK');
  const legacy = RW.evaluatePosition(pos(), T(bidR(2.5), undefined as any, { T2: true }));
  ok('uyarlanabilir girdi yoksa eski T2 davranışı (2,5R → risk çıkışı)', legacy.action === 'close' && legacy.reason === 'risk');
  const yok = RW.evaluatePosition(pos(), T(1.2, adv('YOK')));
  ok('YOK: çıkış yok', yok.action === 'hold');
}
function bidR(R: number) { return 1 + R * (2 / 3); }

// ───── 7) Rejim histerezisi (saf durum makinesi, 2 ardışık 5 dk kapanış) ─────
{
  const seq = (kinds: RG.RegimeKind[]) => kinds.map((kind, k) => ({ t: SS + k * 5 * MIN, kind }));
  const A: RG.RegimeKind = 'trend_up', B: RG.RegimeKind = 'konsolidasyon', C: RG.RegimeKind = 'karisik';
  const flick = RG.hystConfirm(seq([A, A, B, A, B, A]));
  ok('histerezis: tek kapanışlık ham sıçrama onaylanmaz (A kalır)', flick.every(x => x.confirmed === A), flick.map(x => x.confirmed).join(','));
  const two = RG.hystConfirm(seq([A, A, B, B, B]));
  ok('histerezis: 2 ardışık kapanış → B onaylanır (ilk aday kapanışından itibaren)', two[2].confirmed === A && two[3].confirmed === B && two[3].since === SS + 2 * 5 * MIN, JSON.stringify(two[3]));
  const reset = RG.hystConfirm(seq([A, A, B, C, B, B]));
  ok('histerezis: aday değişince sayaç sıfırlanır (B,C,B,B → B yalnız 2 ardışık kapanışta)', reset[4].confirmed === A && reset[5].confirmed === B, reset.map(x => x.confirmed).join(','));
  const pend = RG.hystConfirm(seq([A, B]));
  ok('histerezis: bekleyen aday görünür (raw/confirmed ayrımı)', pend[1].confirmed === A && pend[1].pending?.kind === B && pend[1].pending?.run === 1);
  const first = RG.hystConfirm(seq([C]));
  ok('histerezis: ilk ölçüm doğrudan onaylanır', first[0].confirmed === C);
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nadaptive: tümü geçti');
if (fail) process.exit(1);
