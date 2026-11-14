/* Monte Carlo (§9.3, Başkan incelemesi güncellemesi) ve Fırsat geçiş kriterleri (§9.4) testleri. Saf; ağ yok. */
import { mulberry32, exitForR, runMonteCarlo, targetR, outcomeR, runMcVariants, modeN, type McOutcome } from '../src/lib/paper/mc.ts';
import { FIRSAT_CRITERIA, backtestVerdict, reliable } from '../src/lib/signals/criteria.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const W = (R: number): McOutcome => ({ kind: 'diger', R });
const LOSS: McOutcome = { kind: 'stop' };

// PRNG
{
  const a = mulberry32(7), b = mulberry32(7);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  ok('PRNG: aynı tohum → aynı dizi', xs.every((x, i) => x === ys[i]));
  ok('PRNG: [0,1) aralığında', xs.every(x => x >= 0 && x < 1));
}
// Hedef tanımları (D12: RISK birincil; K8 yalnız karşılaştırma)
ok('RISK: 1:5 → 5R (giriş 150 + 5 × risk 100 = 650 $)', near(targetR('RISK', 5), 5));
ok('K8 (karşılaştırma): 1:5 → 6R (çıkış 5 × giriş, 750 $)', near(targetR('K8', 5), 6));
ok('sonuç: hedef → tanımın R değeri, stop → −1R', near(outcomeR({ kind: 'hedef' }, 'RISK', 5), 5) && near(outcomeR({ kind: 'hedef' }, 'K8', 5), 6) && outcomeR(LOSS, 'RISK') === -1);
ok('çıkış: −1R = stop (fill × 0,50, −%50), +1R = fill × 1,50', near(exitForR(-1, 0.8), 0.8 * 0.5) && near(exitForR(1, 1), 1.5));

// Analitik: 1 gün, 3 kazanç (+1R = fill × 0,50), komisyon 0, fill 0,80, kademe 0,5 → her kazanç ×1,25: 300 → 375 → 468,75 → 585,9375
{
  const r = runMonteCarlo([[W(1), W(1), W(1)]], { startCapital: 300, paths: 20, horizons: [1], fill: 0.8,
    settings: { commission: 0, slippage: 0, fractional: true } });
  ok('MC analitik: 3 kazanç → 585,94 $', near(r[0].medianCapital, 585.9375, 0.01), String(r[0].medianCapital));
  ok('MC analitik: yol başına 3 işlem, iflas 0', r[0].meanTrades === 3 && r[0].ruinProb === 0);
}
// RISK hedefi (5R, −%50): fill 1,50 (150 $), risk = 0,50 × 150 = 75 $ → tek hedef +375 → 675; K8 (6R) → +450 → 750 (karşılaştırma)
{
  const s = { commission: 0, slippage: 0, fractional: true };
  const risk = runMonteCarlo([[{ kind: 'hedef' }]], { startCapital: 300, paths: 5, horizons: [1], fill: 1.5, targetConvention: 'RISK', settings: s });
  const k8 = runMonteCarlo([[{ kind: 'hedef' }]], { startCapital: 300, paths: 5, horizons: [1], fill: 1.5, targetConvention: 'K8', settings: s });
  ok('RISK hedef: 300 → 675 (+375 = 5R)', near(risk[0].medianCapital, 675, 0.01), String(risk[0].medianCapital));
  ok('K8 hedef (karşılaştırma): 300 → 750 (+450)', near(k8[0].medianCapital, 750, 0.01), String(k8[0].medianCapital));
}
// Tek kayıp: kademe 50 → ilk kayıptan sonra 1 kontrat alınamıyor → her yol iflas
{
  const r = runMonteCarlo([[LOSS]], { startCapital: 300, paths: 50, horizons: [20] });
  ok('MC: tek kayıp → iflas olasılığı 1', r[0].ruinProb === 1, String(r[0].ruinProb));
  ok('MC: bitiş sermayesi başlangıcın altında (olasılık 1)', r[0].probBelowStart === 1);
  ok('MC: en uzun kayıp serisi ≥ 1', r[0].longestLossStreak >= 1);
}
// DURDU açık (varsayılan): gün içinde 4 üst üste kayıptan sonra işlem yok; kapalıysa 5. işlem de açılır
{
  // küçük kayıplar (−0,2R): gün içi düşüş %50'ye ulaşmadan yalnız "4 üst üste kayıp" kuralı devreye girsin
  const day: McOutcome[] = [W(-0.2), W(-0.2), W(-0.2), W(-0.2), W(-0.2)];
  const base = { startCapital: 300, paths: 5, horizons: [1], fill: 0.2, seed: 5 };
  const on = runMonteCarlo([day], { ...base, settings: { durduEnabled: true, commission: 1.5 } });
  const off = runMonteCarlo([day], { ...base, settings: { durduEnabled: false, commission: 1.5 } });
  ok('DURDU açık: 4 kayıptan sonra işlem durur (4 işlem)', on[0].meanTrades === 4, String(on[0].meanTrades));
  ok('DURDU kapalı: 5 işlemin hepsi açılır', off[0].meanTrades === 5, String(off[0].meanTrades));
}
// Sürekli kazanç: iflas yok, medyan başlangıçtan büyük
{
  const r = runMonteCarlo([[W(1), W(1)]], { startCapital: 300, paths: 100, horizons: [60], seed: 3 });
  ok('MC: sürekli kazanç → iflas 0, medyan > 300', r[0].ruinProb === 0 && r[0].medianCapital > 300, JSON.stringify(r[0]));
}
// Tekrarlanabilirlik
{
  const days: McOutcome[][] = [[W(1), LOSS, W(0.5)], [LOSS]];
  const a = runMonteCarlo(days, { startCapital: 300, paths: 200, horizons: [20], seed: 11 });
  const b = runMonteCarlo(days, { startCapital: 300, paths: 200, horizons: [20], seed: 11 });
  ok('MC: aynı tohum → aynı sonuç', JSON.stringify(a) === JSON.stringify(b));
}
// Varyantlar: birincil + 3 karşılaştırma, aynı tohum
{
  const v = runMcVariants([[W(1), LOSS], [W(0.5)]], { startCapital: 300, paths: 50, horizons: [20], seed: 9 });
  ok('varyant: 4 kombinasyon, birincil RISK + DURDU açık', v.length === 4 && v[0].targetConvention === 'RISK' && v[0].durduEnabled === true);
  ok('varyant: karşılaştırmalar K8 ve DURDU kapalı içerir', v.some(x => x.targetConvention === 'K8') && v.some(x => !x.durduEnabled));
}
ok('MC: boş gün kümesi hata verir', (() => { try { runMonteCarlo([[]], { startCapital: 300, paths: 1, horizons: [1] }); return false; } catch { return true; } })());

// B8 (Başkan): hedef çarpanı hesabın moduna bağlı — güvenli modda hedef 1:2 (2R), 5R sayılmaz
{
  const s0 = { commission: 0, slippage: 0 };
  ok('modeN: AGRESIF 5, AGRESIF_4 4, AGRESIF_3 3, güvenli 2', modeN('AGRESIF') === 5 && modeN('AGRESIF_4') === 4 && modeN('AGRESIF_3') === 3 && modeN('GUVENLI_ZARAR') === 2 && modeN('GUVENLI_KAR') === 2);
  ok('coklu: N seçimi ve en yakın küçük N', outcomeR({ kind: 'coklu', byN: { '5': -1, '2': 2, '1.5': 1.5 } }, 'RISK', 5) === -1
    && outcomeR({ kind: 'coklu', byN: { '5': -1, '2': 2, '1.5': 1.5 } }, 'RISK', 2) === 2
    && outcomeR({ kind: 'coklu', byN: { '5': -1, '1.5': 1.5 } }, 'RISK', 2) === 1.5);
  // 10 000 $ (iflas eşiğine takılmasın), fill 1,50, komisyon 0 (−%40, 1R = 0,40): K(0,5) → 8000; K(0,4) → 6720; güvenli 2R (0,3): 6720 + 0,3 × 6720 × 0,8 = 8332,8
  const r = runMonteCarlo([[LOSS, LOSS, { kind: 'hedef' }]], { startCapital: 10000, paths: 3, horizons: [1], fill: 1.5, settings: s0 });
  ok('güvenli modda hedef = 2R (5R değil): 10 000 → 7800', near(r[0].medianCapital, 7800, 0.05), String(r[0].medianCapital));
  // coklu: güvenli modda '2' kolonu kullanılır (5R kolonu −1 olsa bile)
  const rc = runMonteCarlo([[LOSS, LOSS, { kind: 'coklu', byN: { '5': -1, '4': -1, '2': 2, '1.5': 1.5 } }]], { startCapital: 10000, paths: 3, horizons: [1], fill: 1.5, settings: s0 });
  ok('coklu: güvenli modda 1:2 kolonu', near(rc[0].medianCapital, 7800, 0.05), String(rc[0].medianCapital));
  // fixedKademe gün içinde de sabit: 2 kayıp %50 → 1000 × (1 − 0,5 × 0,4)² = 640
  const fk = runMonteCarlo([[LOSS, LOSS]], { startCapital: 1000, paths: 2, horizons: [1], fill: 1.5, settings: s0, fixedKademe: 0.5 });
  ok('fixedKademe gün içinde sabit (%50, %50)', near(fk[0].medianCapital, 562.5, 0.05), String(fk[0].medianCapital));
}

// Kriterler (§9.4)
ok('kriter değerleri: n ≥ 60, beklenti ≥ 0,15R, PF ≥ 1,3', FIRSAT_CRITERIA.minN === 60 && FIRSAT_CRITERIA.minExpR === 0.15 && FIRSAT_CRITERIA.minPF === 1.3);
ok('backtest: tüm kapılar → GEÇTİ', (() => { const v = backtestVerdict({ n: 70, expR: 0.2, pf: 1.4, ciLo: 0.02, expRSpread15: 0.05 }); return v.verdict === 'GEÇTİ' && v.failed.length === 0; })());
ok('backtest: n 50 < 60 → KALDI', (() => { const v = backtestVerdict({ n: 50, expR: 0.2, pf: 1.4, ciLo: 0.02, expRSpread15: 0.05 }); return v.verdict === 'KALDI' && v.failed.some(f => f.startsWith('n ')); })());
ok('backtest: GA alt sınırı ve spread başarısız → iki neden', (() => { const v = backtestVerdict({ n: 70, expR: 0.2, pf: 1.4, ciLo: -0.01, expRSpread15: -0.01 }); return v.verdict === 'KALDI' && v.failed.length === 2; })());
ok('backtest: n < 20 → YETERSİZ VERİ', backtestVerdict({ n: 10, expR: 1, pf: 3, ciLo: 1, expRSpread15: 1 }).verdict === 'YETERSİZ VERİ');
ok('güvenilir: backtest geçti + kâğıt n 30, fark 5 puan, beklenti > 0 → ✓', reliable('GEÇTİ', 40, { n: 30, winPct: 35, expR: 0.1 }).ok === true);
ok('güvenilir: kâğıt n 29 → rozet yok', reliable('GEÇTİ', 40, { n: 29, winPct: 40, expR: 0.1 }).ok === false);
ok('güvenilir: kazanma farkı 11 puan → rozet kalkar', reliable('GEÇTİ', 40, { n: 40, winPct: 29, expR: 0.1 }).ok === false);
ok('güvenilir: kâğıt beklenti ≤ 0 → rozet yok', reliable('GEÇTİ', 40, { n: 40, winPct: 40, expR: 0 }).ok === false);
ok('güvenilir: backtest geçmedi → rozet yok', reliable('KALDI', 40, { n: 40, winPct: 40, expR: 0.2 }).ok === false);

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nMonte Carlo ve kriter testleri geçti'); process.exit(fail ? 1 : 0);
