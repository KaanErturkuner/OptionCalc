/* Fırsat setup → backtest Strategy sarmalayıcısı testleri (SINYAL-FIRSAT §9.2). Sentetik barlar; ağ ve token yok. */
import { firsatStrategies, setupCtxOf } from '../src/lib/odte/strategies/firsat.ts';
import type { StratCtx } from '../src/lib/odte/strategies/types.ts';
import type { Bar } from '../src/lib/odte/analytics.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const s1 = firsatStrategies.find(s => s.id === 'firsat-s1')!;
const byId = (id: string) => firsatStrategies.find(s => s.id === id)!;

/** 30 dakika: ilk 15 dk OR (yüksek 100,3 / düşük 99,9), sonra düz; son bar OR'u yukarı kırar, hacim 3×, VWAP altında kalır. */
function breakoutBars(lastVol = 300): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 29; i++) bars.push({ t: i * 60000, o: 100, h: 100.3, l: 99.9, c: 100.1, v: 100 });
  bars.push({ t: 29 * 60000, o: 100.1, h: 100.7, l: 100.4, c: 100.6, v: lastVol });
  return bars;
}
function ctxOf(bars: Bar[], over: Partial<StratCtx> & { em0?: number | null; m?: number } = {}): StratCtx {
  const { em0 = 4, m = bars.length - 1, ...rest } = over;
  const last = bars[bars.length - 1];
  return {
    ticker: 'QQQ', S: last.c, t: last.t, m, bars,
    F: {} as any, chain: (() => ({} as any)) as any, mem: {},
    day: { ticker: 'QQQ', date: '2026-11-13', dte: 0, prevClose: 99.5, openPx: bars[0].o, em0 },
    ...rest,
  } as StratCtx;
}

// Kırılımda S1 giriş üretir: call, hedef 2×OR = 101,4, stop = en az 0,15 EM aşağıda (100,0)
{
  const e = s1.evaluate(ctxOf(breakoutBars()), s1.defaults);
  ok('S1: kırılım → call girişi', e !== null && e.dir === 'call', JSON.stringify(e));
  ok('S1: hedef = giriş + 2 × OR (101,4)', e !== null && near(e.undTarget, 101.4, 1e-6), String(e?.undTarget));
  ok('S1: stop en az 0,15 EM aşağıda (≤ 99,4)', e !== null && e.undStop <= 100.6 - 0.6 + 1e-9, String(e?.undStop));
}
// Hacim yetersiz (1×) → giriş yok
ok('S1: hacim oranı 1× → giriş yok', s1.evaluate(ctxOf(breakoutBars(100)), s1.defaults) === null);
// Günlük EM yok → giriş yok
ok('S1: EM verisi yok → giriş yok', s1.evaluate(ctxOf(breakoutBars(), { em0: null }), s1.defaults) === null);
// Pencere dışı (endMin 240'tan sonra) → giriş yok
ok('S1: pencere dışı (m > 240) → giriş yok', s1.evaluate(ctxOf(breakoutBars(), { m: 300 }), s1.defaults) === null);
// Duvar / haber / IV verisi bu sarmalayıcıda yok → S4, S5, S6 üretmez
ok('S4/S5/S6: veri yokken hiç giriş üretmez', ['firsat-s4', 'firsat-s5', 'firsat-s6'].every(id =>
  byId(id).evaluate(ctxOf(breakoutBars()), byId(id).defaults) === null));
// Bağlam kurulumu: kalan EM zamanla azalır, etMin 09:30 + m
{
  const bars = breakoutBars();
  const c0 = setupCtxOf(ctxOf(bars, { m: 0 }), 'S1')!;
  const c195 = setupCtxOf(ctxOf(bars, { m: 195 }), 'S1')!;
  ok('bağlam: etMin = 570 + m (09:30 = 570)', c0.etMin === 570 && c195.etMin === 765);
  ok('bağlam: kalan EM m=0 → tam EM; m=195 → EM/√2', near(c0.emRemain, 4) && near(c195.emRemain, 4 / Math.SQRT2, 1e-6), `${c0.emRemain} ${c195.emRemain}`);
  ok('bağlam: EM yoksa null', setupCtxOf(ctxOf(bars, { em0: null }), 'S1') === null);
  ok('bağlam: izinli setup yalnız kendisi', c0.allowed.length === 1 && c0.allowed[0] === 'S1');
}
// Kayıt: 6 strateji, kimlikler firsat-s1..s6
ok('kayıt: firsat-s1..s6 (6 strateji)', firsatStrategies.length === 6 && firsatStrategies.map(s => s.id).join(',') === 'firsat-s1,firsat-s2,firsat-s3,firsat-s4,firsat-s5,firsat-s6');

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nFırsat strateji sarmalayıcısı testleri geçti'); process.exit(fail ? 1 : 0);
