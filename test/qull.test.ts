/* Qullamaggie uyarlaması (Kaan onayı yok): günlük bağlam, setuplar, kapı, ayar. Sentetik veri; ağ ve token yok. */
import { ema, atr, atrPct, rs, consolidation, priorMove, extension, qullDaily, QD, type DailyBar } from '../src/lib/signals/qull/daily.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-9) => Number.isFinite(a) && Math.abs(a - b) < eps;

/** n günlük sentetik seri: kapanış f(i), aralık (h−l) = range, açılış = önceki kapanış. Tarihler ardışık (hafta sonu önemsiz). */
function series(n: number, f: (i: number) => number, range = 2, vol = 1000): DailyBar[] {
  const out: DailyBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = f(i), o = i ? out[i - 1].c : c;
    const d = new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
    out.push({ D: d, o, h: Math.max(o, c) + range / 2, l: Math.min(o, c) - range / 2, c, v: typeof vol === 'number' ? vol : 0 });
  }
  return out;
}

// ——— EMA, ATR, göreli güç ———
{
  const e = ema(Array.from({ length: 30 }, (_, i) => i + 1), 10);
  ok('EMA: ilk değer 10 günlük ortalama (5,5)', near(e[9], 5.5));
  ok('EMA: ilk n−1 değer NaN', Number.isNaN(e[8]));
  ok('EMA: sabit seri sabit kalır', ema(new Array(20).fill(7), 5).slice(4).every(x => near(x, 7)));
  const b = series(40, () => 100, 2);
  ok('ATR: sabit aralık 2 → ATR 2', near(atr(b), 2));
  ok('ATR%: 2 / 100 = 0,02', near(atrPct(b), 0.02));
  ok('ATR: yetersiz veri → NaN', Number.isNaN(atr(series(10, () => 100))));
  const stock = series(70, i => 100 * Math.pow(1.01, i));
  const spyFlat = series(70, () => 100);
  ok('RS63: hisse güçlü, SPY düz → pozitif', (rs(stock, spyFlat, 63) ?? -9) > 0.5);
  ok('RS: SPY yok → null', rs(stock, null, 63) === null);
  ok('RS: SPY tarihi eşleşmiyor → null', rs(stock, spyFlat.slice(0, 60), 63) === null);
}

// ——— konsolidasyon, önceki hareket, uzama ———
{
  // önceki 20 gün aralık 2, son 5 gün aralık 1 → daralma 0,5; kapanış son 63 günün yükseğinde → nearHigh
  const bars = series(63, () => 100, 2);
  const tight = bars.slice(0, 58).concat(bars.slice(58).map(b => ({ ...b, h: b.c + 0.5, l: b.c - 0.5 })));
  const k = consolidation(tight);
  ok('daralma: son 5 gün / önceki 20 gün = 0,5', near(k.rangeContraction, 0.5, 1e-6), String(k.rangeContraction));
  ok('daralma: kapanış tepeye yakın (nearHigh)', k.nearHigh);
  ok('daralma: sondan dar gün sayısı > 0', k.days > 0, String(k.days));
  ok('yakın dip: yükselen seride false', !consolidation(series(70, i => 100 + i)).nearLow);
  ok('yakın dip: düşen seride true', consolidation(series(70, i => 200 - i)).nearLow);
  const up = series(70, i => 100 + i);
  const pm = priorMove(up);
  ok('önceki hareket: 63g getiri pozitif', pm.m63 > 0.5, String(pm.m63));
  const ex = extension(up);
  ok('uzama: yükselen seride ardışık yükseliş = n−1', ex.upDays === 69, String(ex.upDays));
  ok('uzama: yükselen seride close > EMA10 → ext > 0', ex.ext > 0, String(ex.ext));
  const dn = series(70, i => 200 - i);
  ok('uzama: düşen seride ardışık düşüş günü sayılır', extension(dn).downDays === 69);
}

// ——— qullDaily: yetersiz geçmiş, trend, kalite, SPY yok ———
{
  ok('qullDaily: 25 bar → null (Q üretmez)', qullDaily(series(QD.MIN_BARS - 1, i => 100 + i), null) === null);
  const up = series(80, i => 100 * Math.pow(1.012, i), 1.5);
  const q = qullDaily(up, null);
  ok('qullDaily: yükselen seri trendUp', !!q && q.trendUp && !q.trendDown);
  ok('qullDaily: SPY yok → spy=false, rs63=null', !!q && !q.spy && q.rs63 === null);
  const dn = series(80, i => 200 * Math.pow(0.99, i), 1.5);
  const qd = qullDaily(dn, null);
  ok('qullDaily: düşen seri trendDown', !!qd && qd.trendDown && !qd.trendUp);
  ok('qullDaily: kalite 0–100 aralığında', !!q && q.quality >= 0 && q.quality <= 100, String(q?.quality));
  const gapped = qullDaily(up, null, up[up.length - 1].c * 1.05);
  ok('qullDaily: açılış verilince gapPct = açılış/kapanış − 1', !!gapped && near(gapped.gapPct ?? NaN, 0.05, 1e-9));
  const spy = series(80, i => 400 * Math.pow(1.001, i), 1);
  const withSpy = qullDaily(up, spy);
  ok('qullDaily: SPY ile RS63 hesaplanır (pozitif, hisse daha hızlı)', !!withSpy && withSpy.spy && (withSpy.rs63 ?? -1) > 0, String(withSpy?.rs63));
}

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\nQullamaggie testleri tamam');
