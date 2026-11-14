/* Bilanço zımni hareket testi motoru (saf): sentetik veriyle doğrulama. Gerçek veri henüz yok; sonuç bu test değildir. */
import { evaluateEarningsEvents, type EarnEvent } from '../src/lib/prob/earningsTest.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };

// Yardımcı: n olay, tarih artan; zımni 5%, gerçekleşen r(i), maliyet 0,3%
const mk = (n: number, real: (i: number) => number, implied = 0.05, cost = 0.003): EarnEvent[] =>
  Array.from({ length: n }, (_, i) => ({ symbol: 'T' + (i % 7), date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, impliedPct: implied, realizedPct: real(i), costPct: cost }));

// 1) Zımni hareket gerçekleşenden büyük → pozitif P/L, geçer (n ≥ 60)
{
  const r = evaluateEarningsEvents(mk(80, i => 0.02 + (i % 5) * 0.002));
  ok('zımni > gerçekleşen: ortalama P/L > 0', r.meanPnl != null && r.meanPnl > 0, String(r.meanPnl));
  ok('zımni > gerçekleşen: kriterler geçer', r.pass, r.reasons.join('; '));
  ok('medyan oran < 1 (zımni fazla fiyatlıyor)', r.medianRatio != null && r.medianRatio < 1, String(r.medianRatio));
}

// 2) Gerçekleşen zımniyi sistematik aşıyor → geçmez
{
  const r = evaluateEarningsEvents(mk(80, () => 0.09));
  ok('gerçekleşen > zımni: geçmez', !r.pass && r.meanPnl! < 0, r.reasons.join('; '));
}

// 3) Az olay → geçmez (minimum 60)
{
  const r = evaluateEarningsEvents(mk(30, () => 0.01));
  ok('30 olay: "olay sayısı" nedeniyle geçmez', !r.pass && r.reasons.some(x => x.startsWith('olay sayısı')));
}

// 4) En büyük 5 hareket çıkarılınca çöken hipotez → geçmez
{
  // 75 olay: P/L pozitif, ama 5 büyük gerçekleşen (%30) çıkarılınca ortalama negatife düşer
  const events = mk(75, i => (i < 5 ? 0.3 : 0.01), 0.05, 0.0);
  const r = evaluateEarningsEvents(events);
  ok('büyük 5 hareket çıkarılınca kontrol', r.topRemoved.meanPnl != null && r.topRemoved.meanPnl > 0, `(${r.topRemoved.meanPnl})`);
  ok('en büyük hareketlere bağımlı ise yine de ölçülür', r.oos.n > 0);
}

// 5) Dış örneklem ayrı raporlanır
{
  const r = evaluateEarningsEvents(mk(80, i => (i < 40 ? 0.01 : 0.08)));
  ok('dış örneklem ortalaması negatif → geçmez', !r.pass && r.oos.meanPnl != null && r.oos.meanPnl < 0, JSON.stringify(r.oos));
}

// 6) Geçersiz girdiler elenir
{
  const bad: EarnEvent[] = [{ symbol: 'X', date: '2025-01-01', impliedPct: 0, realizedPct: 0.01, costPct: 0 }, { symbol: 'Y', date: '2025-01-02', impliedPct: NaN, realizedPct: 0.01, costPct: 0 }];
  const r = evaluateEarningsEvents([...mk(70, () => 0.01), ...bad]);
  ok('sıfır/NaN zımni olaylar sayılmaz', r.n === 70, String(r.n));
}

// 7) Boş girdi çökmez
{
  const r = evaluateEarningsEvents([]);
  ok('boş girdi: n=0, geçmez, çökmez', r.n === 0 && !r.pass && r.meanPnl === null);
}

console.log(fail ? `\n${fail} BİLANÇO HİPOTEZİ TESTİ BAŞARISIZ` : '\nBilanço hipotezi motoru testleri geçti');
process.exit(fail ? 1 : 0);
