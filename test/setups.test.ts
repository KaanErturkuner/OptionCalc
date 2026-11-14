/* Aşama 3 testleri: setuplar (sentetik barlar), RR (enjekte ve gerçek fiyatlayıcı), strike tarayıcı. Ağ ve token yok. */
import { vwap, type Bar } from '../src/lib/odte/analytics.ts';
import type { SetupCtx, SetupId } from '../src/lib/signals/types.ts';
import { orbUyum } from '../src/lib/signals/setups/s1-orb.ts';
import { sikisma } from '../src/lib/signals/setups/s2-sikisma.ts';
import { vwapGeriAlma } from '../src/lib/signals/setups/s3-vwap.ts';
import { duvarKirilim } from '../src/lib/signals/setups/s4-duvar.ts';
import { haberDevam } from '../src/lib/signals/setups/s5-haber.ts';
import { ucuzIv } from '../src/lib/signals/setups/s6-ucuz-iv.ts';
import { allowedFor, runSetups, ALL_SETUPS } from '../src/lib/signals/setups/index.ts';
import { optionRR, MIN_PER_YEAR } from '../src/lib/signals/rr.ts';
import { scanStrikes, type Quote } from '../src/lib/signals/strikes.ts';
import { alignFor } from '../src/lib/signals/align.ts';
import { profileFor } from '../src/lib/signals/profiles.ts';
import { etMinutes, sessionLeftMin, tradingDaysAfter, timeToExpiryMin, timeToExpiryYears, scaleEm, SESSION_MIN } from '../src/lib/signals/session.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const BASE = 1_700_000_000_000;
const B = (i: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t: BASE + i * 60000, o, h, l, c, v });
const flat = (from: number, n: number, c: number, v = 100, o = c): Bar[] => Array.from({ length: n }, (_, k) => B(from + k, o, c + 0.2, c - 0.2, c, v));
const ctxOf = (bars: Bar[], over: Partial<SetupCtx> = {}): SetupCtx => ({
  ticker: 'QQQ', now: bars.at(-1)!.t, etMin: 600, dte: 0, bars, S: bars.at(-1)!.c, em: 4, emRemain: 3,
  vwap: vwap(bars), orHi: 101, orLo: 100, volRatio: 2.5, align: { bull: true, bear: false }, allowed: ALL_SETUPS, ...over,
});

// ---- S1 orb-uyum
const s1bars = [...flat(0, 15, 100.5, 100, 100), ...flat(15, 10, 100.6, 100, 100.5), B(25, 100.7, 100.8, 100.6, 100.7, 100), B(26, 101, 102.2, 100.9, 102.0, 300)];
ok('S1 pozitif: OR yukarı kırılım', orbUyum(ctxOf(s1bars)) != null && orbUyum(ctxOf(s1bars))!.dir === 'bull');
ok('S1 negatif: hacim yetersiz', orbUyum(ctxOf(s1bars, { volRatio: 1 })) == null);
ok('S1 negatif: OR çok geniş (> 0,6 EM)', orbUyum(ctxOf(s1bars, { orHi: 104 })) == null);
ok('S1 negatif: uyum yok', orbUyum(ctxOf(s1bars, { align: { bull: false, bear: false } })) == null);
ok('S1 hedef ≤ açılış + 1,2 EM', (() => { const c = orbUyum(ctxOf(s1bars))!; return c.und.target <= 100 + 1.2 * 4 + 1e-9; })());

// ---- S2 sıkışma
const s2bars = [...flat(0, 20, 100.25, 100, 100.25).map(b => ({ ...b, h: 100.5, l: 100.0 })), B(20, 100.4, 101.2, 100.4, 101, 300)];
ok('S2 pozitif: sıkışma kırılımı', sikisma(ctxOf(s2bars)) != null);
const s2wide = [...flat(0, 20, 101, 100, 101).map((b, i) => ({ ...b, h: 103 + (i % 2), l: 99 })), B(20, 101, 105, 101, 104.5, 300)];
ok('S2 negatif: geniş kutu (sıkışma yok)', sikisma(ctxOf(s2wide)) == null);
ok('S2 negatif: hacim yetersiz', sikisma(ctxOf(s2bars, { volRatio: 1.2 })) == null);

// ---- S3 VWAP geri alma
const s3a = flat(0, 50, 102, 100);
const s3pull = Array.from({ length: 15 }, (_, k) => B(50 + k, 101, 101.2, 100.5, 101, 50));
const s3bars = [...s3a, ...s3pull, B(65, 101, 102.6, 100.9, 102.5, 150)];
ok('S3 pozitif: trend + geri çekilme + hacimli dönüş', vwapGeriAlma(ctxOf(s3bars, { volRatio: 1.6 })) != null);
const s3hvol = [...s3a, ...s3pull.map(b => ({ ...b, v: 200 })), B(65, 101, 102.6, 100.9, 102.5, 150)];
ok('S3 negatif: geri çekilme hacmi yüksek', vwapGeriAlma(ctxOf(s3hvol, { volRatio: 1.6 })) == null);
ok('S3 negatif: dönüş hacmi zayıf', vwapGeriAlma(ctxOf(s3bars, { volRatio: 1.0 })) == null);

// ---- S4 duvar
const s4bars = [B(0, 99.5, 99.9, 99.4, 99.8, 100), B(1, 99.9, 100.4, 99.8, 100.3, 300)];
const s4walls = { call: 100, put: null, gexNeg: true };
ok('S4 pozitif: call duvarı kırılımı', duvarKirilim(ctxOf(s4bars, { walls: s4walls })) != null);
ok('S4 negatif: GEX pozitif', duvarKirilim(ctxOf(s4bars, { walls: { ...s4walls, gexNeg: false } })) == null);
ok('S4 hedef en az 4 × risk', (() => { const c = duvarKirilim(ctxOf(s4bars, { walls: s4walls }))!; return c.und.target - c.und.entry >= 4 * (c.und.entry - c.und.stop) - 1e-9; })());

// ---- S5 haber
const s5bars = [B(0, 100, 100.2, 99.9, 100.1, 100), B(1, 100.5, 102, 100.4, 101.8, 200), B(2, 101.8, 103, 101.6, 102.9, 200), B(3, 102.9, 103, 102.5, 102.8, 150),
  ...Array.from({ length: 5 }, (_, k) => B(4 + k, 102.5, 102.8, 102.2, 102.5, 100)), B(9, 102.5, 103.2, 102.4, 103.2, 200)];
const s5news = { dir: 'bull' as const, t: BASE };
ok('S5 pozitif: haber sonrası devam', haberDevam(ctxOf(s5bars, { newsImpulse: s5news })) != null);
ok('S5 negatif: haber yok', haberDevam(ctxOf(s5bars)) == null);
const s5small = s5bars.map(b => ({ ...b, h: Math.min(b.h, 100.6) }));
ok('S5 negatif: sıçrama < ½ EM', haberDevam(ctxOf(s5small, { newsImpulse: s5news })) == null);

// ---- S6 ucuz IV
const s6bars = [...flat(0, 20, 100.25, 100, 100.25).map(b => ({ ...b, h: 100.5, l: 100.0 })), B(20, 100.4, 101.2, 100.4, 101, 300)];
const s6ok = { dte: 2, ivRank: 10, rv10: 0.3, atmIv: 0.2 };
ok('S6 pozitif: ucuz IV + sıkışma kırılımı', ucuzIv(ctxOf(s6bars, s6ok)) != null);
ok('S6 negatif: 1–3 DTE dışında', ucuzIv(ctxOf(s6bars, { ...s6ok, dte: 5 })) == null);
ok('S6 negatif: IV rank yüksek', ucuzIv(ctxOf(s6bars, { ...s6ok, ivRank: 50 })) == null);

// ---- kısıtlar
ok('GLD: yalnız S1, S2, S5', JSON.stringify(allowedFor('GLD')) === JSON.stringify(['S1', 'S2', 'S5']));
ok('NVDA: yalnız S1, S3, S4', JSON.stringify(allowedFor('NVDA')) === JSON.stringify(['S1', 'S3', 'S4']));
ok('runSetups izinli kümeyi uygular (S4 izinli değil → boş)', runSetups(ctxOf(s1bars, { allowed: ['S4'] as SetupId[] })).length === 0);
ok('runSetups izinli setupı çalıştırır', runSetups(ctxOf(s1bars, { allowed: ['S1'] as SetupId[] })).length === 1);

// ---- RR (enjekte fiyatlayıcı: içsel + zaman değeri × √T)
const stubPricer = (type: 'call' | 'put', S: number, K: number, T: number) => Math.max(0, type === 'call' ? S - K : K - S) + 0.5 * Math.sqrt(Math.max(0, T));
const rrIn = { type: 'call' as const, S: 100, K: 100, T0: 1 / 252, sigma: 0.3, bid: 1.0, ask: 1.0, und: { entry: 100, stop: 98, target: 104 }, emRemain: 3, sessionLeftMin: 300, slippage: 0 };
const r0 = optionRR({ ...rrIn, commission: 0 }, stubPricer);
ok('RR: 1R sabit = giriş × 0,50 (dayanak stopu 1R’yi değiştirmez)', near(r0.risk, 0.5, 1e-9) && r0.valid, JSON.stringify(r0));
ok('RR: stub fiyatlayıcıda R-çarpanı pozitif ve sonlu', r0.rr > 0 && Number.isFinite(r0.rr), String(r0.rr));
// Risk bazlı 1:N (−%50): hedef prim = giriş + N × risk. Sabit fiyatlayıcı: giriş 1 → risk 0,50; 1:5 hedefi = 1 + 5 × 0,50 = 3,5.
const exact = (c: number) => optionRR({ ...rrIn, commission: c, und: { entry: 100, stop: 98, target: 104 } },
  (_t, S) => (S >= 104 ? 1 + 5 * 0.5 : S <= 98 ? 0.5 : 1));
ok('risk bazlı: hedef 1 + 5 × risk → 1:5 (komisyon 0)', near(exact(0).rr, 5, 1e-3), String(exact(0).rr));
ok('RR brüt: komisyon 1,50 $ RR’yi değiştirmez (Kaan kararı)', near(exact(1.5).rr, exact(0).rr, 1e-9), String(exact(1.5).rr));
ok('risk bazlı: ödül = rr × risk', near(exact(0).reward, exact(0).rr * exact(0).risk, 1e-9));
const r1 = optionRR({ ...rrIn, commission: 1.5 }, stubPricer);
ok('RR: komisyon RR’ı değiştirmez (brüt)', near(r1.rr, r0.rr, 1e-9), `${r1.rr} vs ${r0.rr}`);
const cheap0 = optionRR({ ...rrIn, bid: 0.25, ask: 0.25, commission: 0 }, stubPricer), cheap1 = optionRR({ ...rrIn, bid: 0.25, ask: 0.25, commission: 1.5 }, stubPricer);
const dear0 = optionRR({ ...rrIn, commission: 0 }, stubPricer);
ok('RR: ucuz primde de komisyon RR’a girmez', near(cheap0.rr, cheap1.rr, 1e-9), `${cheap0.rr} ${cheap1.rr}`);
ok('RR: teta — kısa vade daha küçük ödül', optionRR({ ...rrIn, T0: 1 / 252 / 4, commission: 0 }, stubPricer).reward < r0.reward);
ok('RR: hedef giriş altındaysa geçersiz', !optionRR({ ...rrIn, und: { entry: 100, stop: 98, target: 99 }, commission: 0 }, stubPricer).valid);
const real = optionRR({ ...rrIn, commission: 1.5 });
ok('RR: gerçek fiyatlayıcı sonlu', Number.isFinite(real.rr) && Number.isFinite(real.risk), JSON.stringify(real));

// ---- strike tarayıcı
const T0 = 1 / 252;
const quotes = (over: Partial<Quote> = {}): Quote[] => [
  { type: 'call', strike: 99, bid: 1.1, ask: 1.12, iv: 0.3, volume: 500, oi: 1000 },        // ITM: dışarıda
  { type: 'call', strike: 101, bid: 0.19, ask: 0.2, iv: 0.3, volume: 500, oi: 1000, ...over },
  { type: 'call', strike: 102, bid: 0.05, ask: 0.06, iv: 0.3, volume: 500, oi: 1000 },      // delta < 0,15
  { type: 'call', strike: 104, bid: 0.01, ask: 0.02, iv: 0.3, volume: 500, oi: 1000 },      // delta çok düşük
];
const sIn = { type: 'call' as const, S: 100, d: 1.2, T0, und: { entry: 0.2, stop: 99.5, target: 103 }, emRemain: 1.5, sessionLeftMin: 300, commission: 0 };
const pick = scanStrikes({ ...sIn, quotes: quotes() });
ok('strike: 101 seçilir (delta 0,15–0,50, OTM, geçerli RR)', pick != null && pick.strike === 101, JSON.stringify(pick && pick.strike));
ok('strike: uzaklık kuralı strike’ı 101', pick != null && pick.dRule.strike === 101);
ok('strike: illikit strike atlanır', scanStrikes({ ...sIn, quotes: quotes({ bid: 0 }) }) == null);
ok('strike: ITM seçilmez', pick != null && pick.strike > 100);
ok('strike: IV yoksa atlanır', scanStrikes({ ...sIn, quotes: quotes({ iv: null }) }) == null);


// ---- A1/A2 uyumu (yardımcı semboller; işaret uygulanmış)
const falling = Array.from({ length: 30 }, (_, k) => B(k, 105 - k * 0.2, 105.2 - k * 0.2, 104.8 - k * 0.2, 105 - k * 0.2, 100));
const rising = Array.from({ length: 30 }, (_, k) => B(k, 100 + k * 0.2, 100.2 + k * 0.2, 99.8 + k * 0.2, 100 + k * 0.2, 100));
const gld = profileFor('GLD');
ok('align GLD: UUP düşerken + TLT düşerken bull uyumu YOK (TLT +1)', alignFor(gld, { UUP: falling, TLT: falling, GDX: rising }, 'bull').vwapAll === false);
ok('align GLD: UUP düşüş (−1 işaret) bull için olumlu, TLT yükseliş olumlu', alignFor(gld, { UUP: falling, TLT: rising, GDX: rising }, 'bull').vwapAll === true);
ok('align: veri yoksa uyum yok', alignFor(gld, {}, 'bull').all === false);
const qqq = profileFor('QQQ');
ok('align QQQ: kendi barları yoksa uyum yok (rejimde QQQ var)', alignFor(qqq, { SPY: rising, SMH: rising, '^VIX': falling }, 'bull').all === false);
ok('align QQQ: kendi + SPY + SMH + VIX (ters işaret) bull uyumu', alignFor(qqq, { QQQ: rising, SPY: rising, SMH: rising, '^VIX': falling }, 'bull').all === true);

// ---- seans zamanı, T0, kalan EM (scanOne matematiği)
const friOpen = Date.parse('2026-11-13T14:30:00Z');   // 09:30 EST
const fri0900 = Date.parse('2026-11-13T14:00:00Z');   // 09:00 EST
const fri1500 = Date.parse('2026-11-13T20:00:00Z');   // 15:00 EST
const friClose = Date.parse('2026-11-13T21:00:00Z');  // 16:00 EST
const julOpen = Date.parse('2026-07-15T13:30:00Z');   // 09:30 EDT
const satNoon = Date.parse('2026-11-14T17:00:00Z');
const thanksgiving = Date.parse('2026-11-26T17:00:00Z');
ok('etMinutes 09:30 EST', etMinutes(friOpen) === 570);
ok('etMinutes 16:00 EST', etMinutes(friClose) === 960);
ok('etMinutes 15:00 EST', etMinutes(fri1500) === 900);
ok('etMinutes 09:30 EDT', etMinutes(julOpen) === 570);
ok('sessionLeftMin açılış = 390', sessionLeftMin(friOpen) === 390);
ok('sessionLeftMin 15:00 = 60', sessionLeftMin(fri1500) === 60);
ok('sessionLeftMin kapanış = 0', sessionLeftMin(friClose) === 0);
ok('sessionLeftMin açılış öncesi tavan 390', sessionLeftMin(fri0900) === 390);
ok('sessionLeftMin cumartesi = 0', sessionLeftMin(satNoon) === 0);
ok('sessionLeftMin Şükran Günü = 0', sessionLeftMin(thanksgiving) === 0);
ok('tradingDaysAfter 0DTE = 0', tradingDaysAfter('2026-11-13', '2026-11-13') === 0);
ok('tradingDaysAfter Cuma→Pazartesi = 1 (hafta sonu sayılmaz)', tradingDaysAfter('2026-11-13', '2026-11-16') === 1);
ok('tradingDaysAfter Çarşamba→Cuma (Şükran Perşembe tatil) = 1', tradingDaysAfter('2026-11-25', '2026-11-27') === 1);
ok('T0 0DTE açılış = 1/252', near(timeToExpiryYears(timeToExpiryMin('2026-11-13', '2026-11-13', 390)), 1 / 252));
ok('T0 0DTE kapanış = 1e-6', timeToExpiryYears(timeToExpiryMin('2026-11-13', '2026-11-13', 0)) === 1e-6);
ok('T0 Cuma 15:00 Pazartesi vade = (390+60)/MIN (takvim dte=3 kullanılmaz)', near(timeToExpiryYears(timeToExpiryMin('2026-11-13', '2026-11-16', 60)), (SESSION_MIN + 60) / MIN_PER_YEAR));
const s0open = scaleEm(2, 390, 390);
ok('0DTE açılış: emRemain = emDay = canlı straddle', near(s0open.emRemain, 2) && near(s0open.emDay, 2));
const s0mid = scaleEm(2, 195, 195);
ok('0DTE yarı seans: emRemain = canlı straddle (çift küçültme yok)', near(s0mid.emRemain, 2));
ok('0DTE yarı seans: emDay tam güne ölçeklenir', near(s0mid.emDay, 2 * Math.sqrt(390 / 195)));
const s1open = scaleEm(2, 390, 780);
ok('1DTE açılış: emRemain = straddle/√2', near(s1open.emRemain, 2 / Math.sqrt(2)));
ok('kapanmış 0DTE: emRemain = 0', scaleEm(2, 0, 0).emRemain === 0);
ok('NaN straddle → NaN EM', Number.isNaN(scaleEm(NaN, 390, 390).emRemain));

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nAşama 3 testleri geçti'); process.exit(fail ? 1 : 0);
