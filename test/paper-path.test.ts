/* OOS işlem dizisi → kâğıt hesap (path.ts) testleri: hedef modu, çakışma, DURDU, MC. Saf; ağ yok. */
import { replayTrades, rUnder, targetFor, runPathMc, bootstrapMeanCiLo, rSummary, exitForRPath, type PathTrade } from '../src/lib/paper/path.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

let seq = 0;
/** Yardımcı: fill 1,00 $; giriş/çıkış zamanları ms; hit = hedef seviyeleri */
function tr(D: string, startMin: number, o: Partial<PathTrade> & { hit?: PathTrade['hit'] } = {}): PathTrade {
  const base = Date.parse(D + 'T13:30:00Z') + startMin * 60000;
  return { id: `t${seq++}`, ticker: 'QQQ', dir: 'call', dte: 0, D, entryT: base, exitT: base + 20 * 60000, fill: 1, R: -1, hit: {}, stopped: true, ...o };
}

// 1) hedef politikası: AGRESIF 1:5, güvenli modlar 1:2
ok('politika: AGRESIF → 5R, GUVENLI_KAR/ZARAR → 2R', targetFor('AGRESIF') === 5 && targetFor('GUVENLI_KAR') === 2 && targetFor('GUVENLI_ZARAR') === 2);
ok('rUnder: hedefe ulaşıldıysa T, yoksa gerçekleşen R', rUnder(tr('2026-01-05', 60, { hit: { 2: true, 5: false }, R: 0.4, stopped: false }), 2) === 2 && rUnder(tr('2026-01-05', 60, { hit: { 2: true }, R: 0.4, stopped: false }), 5) === 0.4);
ok('exit: −1R = fill × 0,60; +5R = fill × 3,00 (−%40 stop)', near(exitForRPath(-1, 1), 0.6) && near(exitForRPath(5, 1), 3.0));

// 2) tek kazanç: 300 $, kademe 0,5 → 150 $ bütçe, 1 kontrat (101,5 $). Net = 5R × 0,40 × 100 − 2 × 1,5 = 197 $ → 497 $
{
  const r = replayTrades([tr('2026-01-05', 60, { hit: { 5: true }, R: 5, stopped: false })], { startCapital: 300, settings: { commission: 1.5 } });
  ok('tek 1:5 kazanç: 300 → 497 $ (1 kontrat, net 197 $)', near(r.final, 497, 1e-6), `final=${r.final}`);
  ok('tek kazanç: sayaç taken=1, kazanç', r.taken === 1 && r.summary.n === 1 && r.summary.winPct === 100);
}

// 3) tek stop: −1R → net = (0,60 − 1) × 100 − 3 = −43 → 257 $ (kademe 0,5 → 1 kontrat)
{
  const r = replayTrades([tr('2026-01-05', 60, { R: -1, stopped: true })], { startCapital: 300 });
  ok('tek stop: 300 → 257 $', near(r.final, 257, 1e-6), `final=${r.final}`);
}

// 4) çakışma: ikinci işlem birincinin bitişinden önce açılmaz
{
  const a = tr('2026-01-05', 60, { R: -1, stopped: true });
  const b = tr('2026-01-05', 62, { R: -1, stopped: true });   // a 20 dk sürüyor → b çakışır
  const r = replayTrades([a, b], { startCapital: 300 });
  ok('çakışma: tek açık pozisyon (busy = 1, taken = 1)', r.busy === 1 && r.taken === 1, `busy=${r.busy} taken=${r.taken}`);
}

// 5) DURDU: 2 kayıp (AGRESIF) → GUVENLI_ZARAR; güvenli modda 2 kayıp daha → DURDU; gün sonuna kadar işlem yok
{
  const day = ['2026-01-05'];
  const ts = [0, 30, 60, 90, 120].map(m => tr(day[0], m, { fill: 0.2, R: -1, stopped: true }));  // 5 ardışık stop (düşük prim: bütçe yetsin)
  const r = replayTrades(ts, { startCapital: 300 });
  ok('DURDU: 4 işlem alındı, 5. işlem DURDU nedeniyle atlandı', r.taken === 4 && r.durdu === 1, `taken=${r.taken} durdu=${r.durdu}`);
  const off = replayTrades(ts, { startCapital: 300, settings: { durduEnabled: false } });
  ok('DURDU kapalı: 5 işlem alınır', off.taken === 5 && off.durdu === 0, `taken=${off.taken} durdu=${off.durdu}`);
}

// 6) güvenli moda geçince hedef 2R: kazanç 2R olarak yazılır
{
  const ts = [
    tr('2026-01-05', 0, { fill: 0.2, R: -1, stopped: true }), tr('2026-01-05', 30, { fill: 0.2, R: -1, stopped: true }),
    tr('2026-01-05', 60, { fill: 0.2, hit: { 2: true, 5: false }, R: 0.2, stopped: false }),
  ];
  const r = replayTrades(ts, { startCapital: 300 });
  const last = r.trades[2];
  ok('güvenli mod: 3. işlem 1:2 hedefiyle kapanır (exit = 1,67 × fill, kazanç)', last?.result === 'kazanc' && last?.mode === 'GUVENLI_ZARAR', `mode=${last?.mode} res=${last?.result}`);
}

// 7) MC: aynı tohum → aynı sonuç; işlemsiz günler de sayılır; iflas tanımı sermaye < %10
{
  const days: PathTrade[][] = [[tr('2026-02-02', 60, { R: -1, stopped: true })], [], [tr('2026-02-03', 60, { hit: { 5: true }, R: 5, stopped: false })]];
  const a = runPathMc(days, { startCapital: 300, horizons: [5, 20], paths: 300, seed: 9 });
  const b = runPathMc(days, { startCapital: 300, horizons: [5, 20], paths: 300, seed: 9 });
  ok('MC: tohum tekrarlanabilir', JSON.stringify(a) === JSON.stringify(b));
  ok('MC: medyan ∈ [p5, p95] ve iflas ∈ [0,1]', a.every(s => s.p5 <= s.median && s.median <= s.p95 && s.ruinProb >= 0 && s.ruinProb <= 1));
}

// 7b) D13(2) (Kaan 2026-11-13): 4 kazanç → GUVENLI_KAR (1:2); orada 2 kayıp → GUVENLI_ZARAR; güvenli modda 2 kayıp daha → o gün DURDU
{
  const wins = [0, 30, 60, 90].map(m => tr('2026-03-02', m, { R: 5, hit: { 5: true }, stopped: false }));
  const losses = [120, 150, 180, 210, 240].map(m => tr('2026-03-02', m, { R: -1, stopped: true }));
  const r = replayTrades([...wins, ...losses], { startCapital: 300 });
  const modes = r.trades.map(t => t.mode);
  ok('D13(2): ilk 4 işlem AGRESIF, 4 kazançtan sonra GUVENLI_KAR',
    modes.slice(0, 4).every(m => m === 'AGRESIF') && modes[4] === 'GUVENLI_KAR', modes.join(','));
  ok('D13(2): GUVENLI_KAR’da 2 kayıp → 7. işlem GUVENLI_ZARAR',
    modes[5] === 'GUVENLI_KAR' && modes[6] === 'GUVENLI_ZARAR', modes.join(','));
  ok('D13(2): güvenli modda 2 kayıp daha → 9. işlem DURDU nedeniyle atlanır (taken 8, durdu 1)',
    r.taken === 8 && r.durdu === 1, `taken=${r.taken} durdu=${r.durdu}`);
}

// 8) istatistik yardımcıları
{
  const s = rSummary([5, -1, 2, -2]);   // kazanç toplamı 7, kayıp toplamı 3
  ok('rSummary: n=4, kazanma %50, PF = 7/3', s.n === 4 && near(s.win!, 0.5) && near(s.pf!, 7 / 3), JSON.stringify(s));
}
ok('bootstrap: sabit dizide CI alt sınırı = ortalama', near(bootstrapMeanCiLo([1, 1, 1, 1, 1, 1], 200, 3), 1));

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nYol/hesap (path) testleri geçti'); process.exit(fail ? 1 : 0);
