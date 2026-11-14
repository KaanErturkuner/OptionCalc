/* Korku ve Açgözlülük (kendi bileşik endeksimiz): saf hesaplamalar, sentetik seriler. */
import { percentileOf, componentFromSeries, momentumDev, safeHavenSeries, junkSeries, rating, composite, buildComponents } from '../src/lib/sentiment/fng.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

// Gerçekçi senaryo: uzun süre yatay, son 30 gün rally (veya düşüş). Düz trend yüzdelik sıralamayı bozar.
const rally = (n: number, base: number, rise: number, tail = 30) => Array.from({ length: n }, (_, i) => (i < n - tail ? base : base + rise * (i - (n - tail)) / tail));
const fall = (n: number, base: number, drop: number, tail = 30) => rally(n, base, -drop, tail);

ok('yüzdelik: en büyük değer → 100 (pencere büyüklüğü yeterli)', percentileOf(200, Array.from({ length: 30 }, (_, i) => i)) === 100);
ok('yüzdelik: pencere küçükse null (çökme yok)', percentileOf(5, [1, 2, 3]) === null);

// Yükselen seri: son değer en yüksek → momentum bileşeni açgözlülük (yüksek)
{
  const s = componentFromSeries(momentumDev(rally(200, 100, 20)));
  ok('momentum: sürekli yükseliş → açgözlülük (≥ 80)', s != null && s >= 80, String(s));
}
// Düşen seri: momentum düşük → korku
{
  const s = componentFromSeries(momentumDev(fall(200, 100, 20)));
  ok('momentum: sürekli düşüş → korku (≤ 20)', s != null && s <= 20, String(s));
}
// VIX ters: VIX yükseldiyse korku (düşük puan)
{
  const vixRising = componentFromSeries(rally(200, 12, 8), true);
  const vixFalling = componentFromSeries(fall(200, 30, 15), true);
  ok('VIX yükselişi → düşük puan (korku)', vixRising != null && vixRising <= 20, String(vixRising));
  ok('VIX düşüşü → yüksek puan (açgözlülük)', vixFalling != null && vixFalling >= 80, String(vixFalling));
}
// Güvenli liman: SPY tahvilden iyi → açgözlülük
{
  const spy = rally(120, 100, 20), tlt = Array.from({ length: 120 }, () => 100);
  const s = componentFromSeries(safeHavenSeries(spy, tlt));
  ok('SPY tahvilden iyi → açgözlülük', s != null && s >= 80, String(s));
}
// Junk: HYG/LQD oranı yükselirse açgözlülük
{
  const s = componentFromSeries(junkSeries(rally(120, 80, 10), Array.from({ length: 120 }, () => 100)));
  ok('HYG/LQD yükselişi → açgözlülük', s != null && s >= 80, String(s));
}

// Bant sınırları
ok('bant: 0 → Aşırı korku, 24 → Aşırı korku', rating(0) === 'Aşırı korku' && rating(24) === 'Aşırı korku');
ok('bant: 25 → Korku, 44 → Korku', rating(25) === 'Korku' && rating(44) === 'Korku');
ok('bant: 45 → Nötr, 55 → Nötr', rating(45) === 'Nötr' && rating(55) === 'Nötr');
ok('bant: 56 → Açgözlülük, 75 → Açgözlülük', rating(56) === 'Açgözlülük' && rating(75) === 'Açgözlülük');
ok('bant: 76 → Aşırı açgözlülük, 100 → Aşırı açgözlülük', rating(76) === 'Aşırı açgözlülük' && rating(100) === 'Aşırı açgözlülük');

// Bileşik: en az 2 bileşen; eksikler yok sayılır
{
  const r = composite([{ key: 'vix', label: 'a', score: 80 }, { key: 'momentum', label: 'b', score: 60 }, { key: 'junk', label: 'c', score: null }]);
  ok('bileşik: eşit ağırlık ortalaması (80+60)/2 = 70, Açgözlülük', r.score === 70 && r.rating === 'Açgözlülük' && r.used === 2, JSON.stringify(r.score));
}
{
  const r = composite([{ key: 'vix', label: 'a', score: 80 }, { key: 'momentum', label: 'b', score: null }]);
  ok('bileşik: 1 bileşen → puan yok (çökmez)', r.score === null && r.rating === null);
}

// Uçtan uca (sentetik): boğa piyasası vs ayı piyasası
{
  const bull = composite(buildComponents({ vix: fall(200, 30, 15), spy: rally(200, 100, 20), tlt: Array.from({ length: 200 }, () => 100), hyg: rally(200, 80, 10), lqd: Array.from({ length: 200 }, () => 100) }));
  const bear = composite(buildComponents({ vix: rally(200, 12, 8), spy: fall(200, 200, 40), tlt: rally(200, 100, 10), hyg: fall(200, 120, 15), lqd: Array.from({ length: 200 }, () => 100) }));
  ok('boğa senaryosu: bileşik puan yüksek', bull.score != null && bull.score >= 70, String(bull.score));
  ok('ayı senaryosu: bileşik puan düşük', bear.score != null && bear.score <= 30, String(bear.score));
  ok('sonuç notu: CNN ile aynı olmadığı açıkça yazılı', bull.note.includes('CNN ile aynı değil'));
}

console.log(fail ? `\n${fail} KORKU-AÇGÖZLÜLÜK TESTİ BAŞARISIZ` : '\nKorku ve açgözlülük testleri geçti');
process.exit(fail ? 1 : 0);
