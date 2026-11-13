/* Monte Carlo (§9.3) ve Fırsat geçiş kriterleri (§9.4) testleri. Saf; ağ yok. */
import { mulberry32, exitForR, runMonteCarlo } from '../src/lib/paper/mc.ts';
import { FIRSAT_CRITERIA, backtestVerdict, reliable } from '../src/lib/signals/criteria.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// PRNG
{
  const a = mulberry32(7), b = mulberry32(7);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  ok('PRNG: aynı tohum → aynı dizi', xs.every((x, i) => x === ys[i]));
  ok('PRNG: [0,1) aralığında', xs.every(x => x >= 0 && x < 1));
}
// Çıkış formülü
ok('çıkış: −1R = stop (fill/3)', near(exitForR(-1, 0.8), 0.8 / 3));
ok('çıkış: +1R = fill × 5/3', near(exitForR(1, 1), 5 / 3));
ok('çıkış: 0R = giriş', near(exitForR(0, 0.8), 0.8));

// Analitik: 1 gün, 3 kazanç (+1R), komisyon 0, kesirli, fill 0,80 → 300 → 400 → 533,33 → 711,11
{
  const r = runMonteCarlo([[1, 1, 1]], { startCapital: 300, paths: 20, horizons: [1], fill: 0.8,
    settings: { commission: 0, slippage: 0, fractional: true } });
  ok('MC analitik: 3 kazanç → 711,11 $', near(r[0].medianCapital, 711.11, 0.01), String(r[0].medianCapital));
  ok('MC analitik: yol başına 3 işlem, iflas 0', r[0].meanTrades === 3 && r[0].ruinProb === 0);
}
// Tek kayıp: kademe 50 → ilk kayıptan sonra 1 kontrat alınamıyor → her yol iflas
{
  const r = runMonteCarlo([[-1]], { startCapital: 300, paths: 50, horizons: [20] });
  ok('MC: tek kayıp → 1 kontrat alınamıyor → iflas olasılığı 1', r[0].ruinProb === 1, String(r[0].ruinProb));
  ok('MC: bitiş sermayesi başlangıcın altında (olasılık 1)', r[0].probBelowStart === 1);
  ok('MC: en uzun kayıp serisi ≥ 1', r[0].longestLossStreak >= 1);
}
// Sürekli kazanç: iflas yok, medyan başlangıçtan büyük
{
  const r = runMonteCarlo([[1, 1]], { startCapital: 300, paths: 100, horizons: [60], seed: 3 });
  ok('MC: sürekli kazanç → iflas 0, medyan > 300', r[0].ruinProb === 0 && r[0].medianCapital > 300, JSON.stringify(r[0]));
}
// Tekrarlanabilirlik
{
  const a = runMonteCarlo([[1, -1, 0.5], [-1]], { startCapital: 300, paths: 200, horizons: [20], seed: 11 });
  const b = runMonteCarlo([[1, -1, 0.5], [-1]], { startCapital: 300, paths: 200, horizons: [20], seed: 11 });
  ok('MC: aynı tohum → aynı sonuç', JSON.stringify(a) === JSON.stringify(b));
}
ok('MC: boş gün kümesi hata verir', (() => { try { runMonteCarlo([[]], { startCapital: 300, paths: 1, horizons: [1] }); return false; } catch { return true; } })());

// Kriterler (§9.4)
ok('kriter değerleri: n ≥ 60, beklenti ≥ 0,15R, PF ≥ 1,3', FIRSAT_CRITERIA.minN === 60 && FIRSAT_CRITERIA.minExpR === 0.15 && FIRSAT_CRITERIA.minPF === 1.3);
{
  const v = backtestVerdict({ n: 70, expR: 0.2, pf: 1.4, ciLo: 0.02, expRSpread15: 0.05 });
  ok('backtest: tüm kapılar → GEÇTİ', v.verdict === 'GEÇTİ' && v.failed.length === 0);
}
{
  const v = backtestVerdict({ n: 50, expR: 0.2, pf: 1.4, ciLo: 0.02, expRSpread15: 0.05 });
  ok('backtest: n 50 < 60 → KALDI', v.verdict === 'KALDI' && v.failed.some(f => f.startsWith('n ')));
}
{
  const v = backtestVerdict({ n: 70, expR: 0.2, pf: 1.4, ciLo: -0.01, expRSpread15: -0.01 });
  ok('backtest: GA alt sınırı ve spread başarısız → iki neden', v.verdict === 'KALDI' && v.failed.length === 2, JSON.stringify(v.failed));
}
ok('backtest: n < 20 → YETERSİZ VERİ', backtestVerdict({ n: 10, expR: 1, pf: 3, ciLo: 1, expRSpread15: 1 }).verdict === 'YETERSİZ VERİ');
ok('güvenilir: backtest geçti + kâğıt n 30, fark 5 puan, beklenti > 0 → ✓', reliable('GEÇTİ', 40, { n: 30, winPct: 35, expR: 0.1 }).ok === true);
ok('güvenilir: kâğıt n 29 → rozet yok', reliable('GEÇTİ', 40, { n: 29, winPct: 40, expR: 0.1 }).ok === false);
ok('güvenilir: kazanma farkı 11 puan → rozet kalkar', reliable('GEÇTİ', 40, { n: 40, winPct: 29, expR: 0.1 }).ok === false);
ok('güvenilir: kâğıt beklenti ≤ 0 → rozet yok', reliable('GEÇTİ', 40, { n: 40, winPct: 40, expR: 0 }).ok === false);
ok('güvenilir: backtest geçmedi → rozet yok', reliable('KALDI', 40, { n: 40, winPct: 40, expR: 0.2 }).ok === false);

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nMonte Carlo ve kriter testleri geçti'); process.exit(fail ? 1 : 0);
