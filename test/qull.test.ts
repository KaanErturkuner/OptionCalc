/* Qullamaggie uyarlaması (Kaan onayı yok): günlük bağlam, setuplar, kapı, ayar. Sentetik veri; ağ ve token yok. */
import { q1Orh, q1sOrl } from '../src/lib/signals/setups/q1-orh.ts';
import { q2Ep } from '../src/lib/signals/setups/q2-ep.ts';
import { q3Parabolik, failedVwapReclaim } from '../src/lib/signals/setups/q3-parabolik.ts';
import { allowedFor, runSetups } from '../src/lib/signals/setups/index.ts';
import { DEFAULT_Q, enabledQ, Q_PAPER_ELIGIBLE, isQ, mergeQ } from '../src/lib/signals/qull/policy.ts';
import { buildOpp } from '../src/lib/signals/opp.ts';
import type { SetupCtx } from '../src/lib/signals/types.ts';
import type { Bar } from '../src/lib/odte/analytics.ts';
import type { QDaily } from '../src/lib/signals/qull/daily.ts';
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


// ——— Setuplar (Qullamaggie uyarlaması — Kaan onayı yok) ———
const b1 = (o: number, h: number, l: number, c: number, v = 1000): Bar => ({ t: 0, o, h, l, c, v });
/** Günlük bağlam: trend/daralma/yakınlık alanları elle (setup mantığı test ediliyor, günlük hesap değil). */
function qdFake(over: Partial<QDaily> = {}): QDaily {
  const base = qullDaily(series(80, i => 100 * Math.pow(1.005, i), 1.5), null)!;
  return { ...base, trendUp: true, trendDown: false, spy: false, rs63: null,
    consol: { days: 5, rangeContraction: 0.5, higherLows: true, nearHigh: true, nearLow: false }, ...over } as QDaily;
}
/** Açılış aralığı (bar 0–4: yüksek 100,5 / düşük 99,8), sonra kırılım barı (5): kapanış 100,8, önceki kapanış 100,2. */
function upBars(): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < 5; i++) out.push({ t: i * 60000, o: 100, h: 100.5, l: 99.8, c: 100.2, v: 1000 });
  out.push({ t: 5 * 60000, o: 100.2, h: 100.9, l: 100.1, c: 100.8, v: 2500 });
  return out;
}
/** Aşağı ayna: OR bar 0–4 (yüksek 100,2 / düşük 99,5), kırılım barı kapanış 99,0. */
function downBars(): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < 5; i++) out.push({ t: i * 60000, o: 100, h: 100.2, l: 99.5, c: 99.8, v: 1000 });
  out.push({ t: 5 * 60000, o: 99.8, h: 99.9, l: 99.0, c: 99.0, v: 2500 });
  return out;
}
function ctxQ(bars: Bar[], over: Partial<SetupCtx> = {}): SetupCtx {
  const last = bars[bars.length - 1];
  const orHi = Math.max(...bars.slice(0, 5).map(b => b.h)), orLo = Math.min(...bars.slice(0, 5).map(b => b.l));
  return {
    ticker: 'QQQ', now: 0, etMin: 570 + bars.length - 1, dte: 0, bars, S: last.c, em: 4, emRemain: 2,
    vwap: last.c, orHi, orLo, volRatio: 2.0, align: { bull: true, bear: true }, allowed: ['Q1', 'Q1S', 'Q2', 'Q3'],
    qd: qdFake(), orWin: { m5: { high: orHi, low: orLo }, m30: null }, ...over,
  };
}

// Q1: yükseliş kırılımı
{
  const c = ctxQ(upBars());
  const r = q1Orh(c);
  ok('Q1: trend + daralma + yakın tepe + ORH kırılımı + hacim → aday (call)', !!r && r.dir === 'bull' && r.setup === 'Q1');
  ok('Q1: stop = gün dibi (99,8), hedef = giriş + 2 × risk', !!r && near(r.und.stop, 99.8) && near(r.und.target, 100.8 + 2 * (100.8 - 99.8)), JSON.stringify(r?.und));
  ok('Q1: aşağı yön (Q1S) aynı barda aday üretmez', q1sOrl(c) === null);
  ok('Q1: trend yok → yok', q1Orh(ctxQ(upBars(), { qd: qdFake({ trendUp: false }) })) === null);
  ok('Q1: daralma > 0,8 → yok', q1Orh(ctxQ(upBars(), { qd: qdFake({ consol: { days: 0, rangeContraction: 1.1, higherLows: false, nearHigh: true, nearLow: false } }) })) === null);
  const lowV = upBars(); lowV[5] = { ...lowV[5], v: 1200 };
  ok('Q1: kırılım barında hacim 1,2× (< 1,5) → yok', q1Orh(ctxQ(lowV)) === null);
  ok('Q1: SPY var, rs63 < 0 → yok (SPY’den güçlü değil)', q1Orh(ctxQ(upBars(), { qd: qdFake({ spy: true, rs63: -0.02 }) })) === null);
  ok('Q1: SPY var, rs63 > 0 → aday', q1Orh(ctxQ(upBars(), { qd: qdFake({ spy: true, rs63: 0.05 }) })) !== null);
  ok('Q1: pencere dışı (13:00 sonrası) → yok', q1Orh(ctxQ(upBars(), { etMin: 800 })) === null);
  ok('Q1: günlük veri yok (qd null) → yok', q1Orh(ctxQ(upBars(), { qd: null })) === null);
  ok('Q1: OR verisi yok → yok', q1Orh(ctxQ(upBars(), { orWin: null })) === null);
  const old = [...upBars().slice(0, 5), { t: 5 * 60000, o: 100.2, h: 100.9, l: 100.1, c: 100.8, v: 2500 }, ...Array.from({ length: 9 }, (_, i) => ({ t: (6 + i) * 60000, o: 100.7, h: 100.9, l: 100.6, c: 100.7, v: 1000 })), { t: 15 * 60000, o: 100.7, h: 101, l: 100.6, c: 100.9, v: 1000 }];
  ok('Q1: ilk kırılım 10 dk önce (taze değil) → yok', q1Orh(ctxQ(old)) === null);
  const grid: Bar[] = [...upBars().slice(0, 5), { t: 5 * 60000, o: 100.2, h: 100.3, l: 100.1, c: 100.2, v: 1000 }, { t: 6 * 60000, o: 100.2, h: 101, l: 100.2, c: 100.9, v: 2500 },
    { t: 7 * 60000, o: 100.9, h: 101, l: 100.7, c: 100.85, v: 1000 }, { t: 8 * 60000, o: 100.85, h: 101, l: 100.7, c: 100.8, v: 1000 }];
  const gr = q1Orh(ctxQ(grid));
  ok('Q1: kırılım 2 bar önce (ızgara arası), son bar hâlâ üstünde → aday', !!gr && near(gr.und.entry, 100.8), JSON.stringify(gr?.und));
  const p30 = ctxQ(upBars(), { qp: { orMin: 30, volMult: 1.5, gapMult: 1.5 }, orWin: { m5: { high: 100.5, low: 99.8 }, m30: { high: 101.5, low: 99.0 } } });
  ok('Q1: orMin 30 → 30 dk aralığı kullanılır (100,8 < 101,5 → yok)', q1Orh(p30) === null);
}

// Q1S: aşağı kırılım (ayna)
{
  const c = ctxQ(downBars(), { qd: qdFake({ trendUp: false, trendDown: true, consol: { days: 4, rangeContraction: 0.6, higherLows: false, nearHigh: false, nearLow: true } }) });
  const r = q1sOrl(c);
  ok('Q1S: trend aşağı + yakın dip + ORL kırılımı → put adayı', !!r && r.dir === 'bear' && r.setup === 'Q1S');
  ok('Q1S: stop = gün zirvesi (100,2), hedef = giriş − 2 × risk', !!r && near(r.und.stop, 100.2) && near(r.und.target, 99.0 - 2 * (100.2 - 99.0)), JSON.stringify(r?.und));
  ok('Q1S: yakın dip değil → yok', q1sOrl({ ...c, qd: qdFake({ trendUp: false, trendDown: true, consol: { days: 4, rangeContraction: 0.6, higherLows: false, nearHigh: false, nearLow: false } }) }) === null);
}

// Q2 Episodic Pivot
{
  const gap: Bar[] = [];
  for (let i = 0; i < 15; i++) gap.push({ t: i * 60000, o: i ? 105.2 : 105, h: 105.5, l: 104.8, c: 105.2, v: 300 });
  gap.push({ t: 15 * 60000, o: 105.2, h: 106.2, l: 105.1, c: 106, v: 1000 });
  const qd = qdFake({ lastClose: 100, atrPct: 0.02, avgVol20: 26000, trendUp: false });
  const r = q2Ep(ctxQ(gap, { qd, volRatio: 2 }));
  ok('Q2: %5 gap + ilk 15 dk hacim yeterli + ORH kırılımı → call', !!r && r.setup === 'Q2' && r.dir === 'bull', JSON.stringify(r?.reason));
  ok('Q2: gap %1 (eşik %3) → yok', q2Ep(ctxQ(gap.map((b, i) => i === 0 ? { ...b, o: 101 } : b), { qd, volRatio: 2 })) === null);
  const lowVol = gap.map((b, i) => i < 15 ? { ...b, v: 100 } : b);
  ok('Q2: ilk 15 dk hacmi normalin 3 katından az → yok', q2Ep(ctxQ(lowVol, { qd, volRatio: 2 })) === null);
  ok('Q2: günlük veri yok → yok', q2Ep(ctxQ(gap, { qd: null, volRatio: 2 })) === null);
  const dn = gap.map((b, i) => i < 15 ? { ...b, o: i ? 95.2 : 95, h: 95.5, l: 94.8, c: 95.2 } : { ...b, o: 95.2, h: 95.4, l: 94.0, c: 94 });
  const rd = q2Ep(ctxQ(dn, { qd, volRatio: 2 }));
  ok('Q2: aşağı gap + aşağı kırılım → put (Q2)', !!rd && rd.dir === 'bear', JSON.stringify(rd?.reason));
}

// Q3 parabolik short (varsayılan kapalı)
{
  const qd = qdFake({ ext: 3.5, upDays: 4, trendUp: false, trendDown: false });
  const c = ctxQ(downBars(), { qd });
  const r = q3Parabolik(c);
  ok('Q3: uzama ≥ 3 ATR, ≥ 3 yükseliş günü + ORL kırılımı → put', !!r && r.dir === 'bear' && r.setup === 'Q3');
  ok('Q3: uzama 2 ATR → yok', q3Parabolik({ ...c, qd: { ...qd, ext: 2 } }) === null);
  const vw: Bar[] = [b1(100, 101, 99, 100, 100), b1(99, 100.5, 98, 98.5, 100), b1(100, 101, 100, 100.5, 100)];
  ok('Q3: VWAP altına sarkıp geri alamama (ilk 30 dk) → tetik', failedVwapReclaim(vw.slice(0, 2)) === true);
  ok('Q3: VWAP geri alındı → tetik yok', failedVwapReclaim(vw) === false);
  ok('Q3 varsayılan kapalı: ayarlardan açık Q listesi Q3 içermez', !enabledQ(DEFAULT_Q).includes('Q3'));
  ok('Q3: allowedFor (varsayılan Q) Q1/Q1S/Q2 içerir, Q3 içermez', JSON.stringify(allowedFor('QQQ', enabledQ(DEFAULT_Q))) === JSON.stringify(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'Q1', 'Q1S', 'Q2']));
  ok('Q: GLD kısıtı S setlerinde kalır, Q eklenir', JSON.stringify(allowedFor('GLD', ['Q1'])) === JSON.stringify(['S1', 'S2', 'S5', 'Q1']));
  ok('Q: runSetups Q1 adayını döndürür', runSetups(ctxQ(upBars(), { allowed: ['Q1'] })).length === 1);
}

// Kâğıt kapısı: Q setupları kâğıda uygun değil
{
  ok('kapı: Q_PAPER_ELIGIBLE boş (Kaan onayı yok)', Q_PAPER_ELIGIBLE.size === 0);
  ok('kapı: isQ yalnız Q kimlikleri', isQ('Q1') && isQ('Q1S') && isQ('Q2') && isQ('Q3') && !isQ('S1'));
  ok('ayar migrasyonu: eksik Q alanları varsayılana döner', JSON.stringify(mergeQ({ Q3: true })) === JSON.stringify({ ...DEFAULT_Q, Q3: true }) && mergeQ(undefined).Q1 === true);
  const c = ctxQ(upBars());
  const cand = q1Orh(c)!;
  const pick: any = { strike: 101, delta: 0.5, rr: { rr: 5, entry: 1.5, primStop: 0.5, target: 9, bid: 1.4, ask: 1.5 }, dRule: { strike: 101, rr: null }, skipped: [] };
  const opp = buildOpp({
    ticker: 'QQQ', setup: 'Q1', dir: 'bull', pick, spot: 100.8, und: cand.und, reasons: cand.reason,
    em: 4, emRemain: 2, expiry: '2026-11-13', dte: 0, etMin: 575, leftMin: 300, marketOpen: true, now: Date.now(),
    delayedMin: 0, barAgeSec: 5, chainAgeSec: 5,
    regime: { vwapAll: true, orAll: true, opposite: false }, sector: { present: false, vwapOk: false },
    frames: 3, volRatio: 2, radar: { same: 0, oppMax: 0 }, maxSpreadPct: 8, spreadPct: 2, liquid: true,
    account: { mode: 'AGRESIF', capital: 300, kademe: 0.5, commission: 1.5, fractional: false },
    ttlMin: 3, quote: { bid: 1.4, ask: 1.5, iv: 0.3 }, qual: { score: 62, note: 'Q1: test' },
  } as any);
  ok('kart: Q1 adayı eligible = false', opp.eligible === false);
  ok('kart: sebep "Q: backtest kriteri geçilmedi"', opp.reason === 'Q: backtest kriteri geçilmedi', opp.reason);
  ok('kart: Q-kalite satırı taşınır (62/100)', opp.qual?.score === 62 && opp.text.body.includes('Q-kalite 62/100'));
}

// Çıkış uyarlamaları (varsayılan kapalı)
{
  const { qExitTriggers, fiveMinCloses, ema5Broken } = await import('../src/lib/signals/qull/exits.ts');
  const bs: Bar[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 60000, o: 100, h: 100.2, l: 99.8, c: 100, v: 100 }));
  const pos = { setup: 'Q1', dir: 'call' as const, und: { stop: 99.8 } };
  ok('çıkış: varsayılan kapalı → tetik yok (LOD kırık olsa bile)', !qExitTriggers(pos, [...bs.slice(0, 59), { ...bs[0], c: 99.5 }], { lod: false, ema: false }).lod);
  const broken = [...bs.slice(0, 59), { ...bs[0], c: 99.5, l: 99.4 }];
  ok('çıkış: LOD açık + kapanış LOD altında → lod tetik', qExitTriggers(pos, broken, { lod: true, ema: false }).lod);
  ok('çıkış: Q olmayan pozisyonda tetik yok', !qExitTriggers({ ...pos, setup: 'S1' }, broken, { lod: true, ema: true }).lod);
  ok('çıkış: 5 dk kapanış < 10 → EMA tetiği yok', !ema5Broken(pos, bs.slice(0, 30)));
  const up = Array.from({ length: 80 }, (_, i) => ({ t: i * 60000, o: 100, h: 101, l: 99, c: 100 + i * 0.05, v: 100 }));
  ok('çıkış: 5 dk kapanış sayısı = ⌊n/5⌋', fiveMinCloses(up).length === 16);
  ok('çıkış: yükselen seride call EMA tetiği yok', !ema5Broken(pos, up));
  const dropAtEnd = [...up.slice(0, 79), { ...up[79], c: 90 }];
  ok('çıkış: son 5 dk kapanış EMA10 altına düşerse call EMA tetiği', ema5Broken(pos, dropAtEnd));
}

// Çıkış uyarlamaları paper motorunda (ayar açık olmadan etkisiz)
{
  const { tickPosition } = await import('../src/lib/paper/engine.ts');
  const { initAccount, openPosition } = await import('../src/lib/paper/account.ts');
  const D = '2026-11-13';
  const acc = (openPosition(initAccount(300, { commission: 0, slippage: 0 } as any, D), { id: 'q1', ticker: 'QQQ', setup: 'Q1', dir: 'call', expiry: D, dte: 0,
    strike: 100, fill: 1, stopPrem: 0.6, targetPrem: 3, targetR: 5, mode: 'AGRESIF', now: 0, day: D, und: { entry: 100, stop: 99.8, target: 102.8 } } as any) as any).acc;
  const base: any = { day: D, now: 1, etMin: 600, bid: 1, flags: {}, S: 99.5, ivAtm: 0.2, calendar: { ok: true, reasons: [] }, strongTriggerLast30: false, regimeAligned: true };
  ok('Q çıkış: ayar kapalı (qExit yok) → pozisyon açık kalır', tickPosition(acc, base).acc.position !== null);
  const on = tickPosition(acc, { ...base, qExit: { lod: true, ema: false } });
  ok('Q çıkış: LOD açık + tetik → kapanır (risk)', on.acc.position === null && on.events[0]?.trade?.reason === 'risk', JSON.stringify(on.events.map(e => e.text)));
  const em = tickPosition(acc, { ...base, qExit: { lod: false, ema: true } });
  ok('Q çıkış: EMA açık + tetik → iz süren stop nedeniyle kapanır', em.acc.position === null && em.events[0]?.trade?.reason === 'iz-suren-stop');
}

// Backtest sızıntısızlığı: gün i için yalnız D < i günlük barları kullanılır
{
  const { qdOf } = await import('../src/lib/odte/strategies/qull.ts');
  const full = series(120, i => 100 + Math.sin(i / 5) * 5 + i * 0.1, 2);
  const date = full[80].D;
  const clean: any = { ticker: 'LEAK_A', date, dte: 0, prevClose: null, openPx: NaN, em0: 1, daily: full };
  const tampered = full.map((b, i) => i >= 80 ? { ...b, c: 1e6, h: 1e6, l: 1, v: 1e9 } : b);
  const dirty: any = { ticker: 'LEAK_B', date, dte: 0, prevClose: null, openPx: NaN, em0: 1, daily: tampered };
  const a = qdOf(clean), b = qdOf(dirty);
  ok('sızıntı: gelecek günler bozulsa da gün i’nin bağlamı aynı', a !== null && JSON.stringify(a) === JSON.stringify(b));
  ok('sızıntı: geçmiş yetersizse (10 gün) null — gelecek veri kullanılmaz', qdOf({ ...clean, ticker: 'LEAK_C', date: full[10].D }) === null);
}

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\nQullamaggie testleri tamam');
