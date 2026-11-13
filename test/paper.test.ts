/* Kâğıt hesap (Aşama 4) testleri — SINYAL-FIRSAT §7: Kaan'ın sayısal örnekleri (§7.2 1–8, §6.1), durum geçişleri,
 * risk izleyici (T1–T7, iz süren stop), onay süresi/fiyat kayması, gece taşıma, %50 özellik testi. Ağ ve token yok. */
import { initAccount, startDay, openPosition, closePosition, nextMode, eligibility, chooseCandidate, signalModeFor, summarize, classify, MODE_RULES } from '../src/lib/paper/account.ts';
import { kademeAfter, sizePosition, budgetFor, KADEMELER } from '../src/lib/paper/sizing.ts';
import { entryFill, exitFill, isTradable, delayedEntryAsk, netPnl, BROKER_COMMISSION, DEFAULT_COMMISSION } from '../src/lib/paper/costs.ts';
import { approvalTtlMs, expiryReason, repriceOnApprove, resolveApproval, type ApprovalSignal, type ApprovalTick } from '../src/lib/paper/approval.ts';
import { nextTradingDay, sigmaNight, overnightDecision, gapOpenAction } from '../src/lib/paper/overnight.ts';
import type { OpenPosition, PaperAccount } from '../src/lib/paper/types.ts';
import { t1ReversalCandle, t2VwapLoss, t3RegimeFlip, t4MomentumDivergence, t5IvDrop, t6Theta, t7KeyLevel,
  trailPrem, modeTargetR, effectiveStopPrem, evaluatePosition, profitR, exitThresholdR, PRIM_STOP_MAX } from '../src/lib/signals/riskwatch.ts';
import type { Bar } from '../src/lib/odte/analytics.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

const D = '2026-11-13';                 // Cuma (ET)
const NOCOST = { commission: 0, slippage: 0, fractional: true };  // Kaan'ın örnekleri: komisyon 0, kesirli simülasyon açık

/** Kaan'ın yuvarlak örnekleri: prim stopu giriş/3 (150 → 50), hedef 1:R. */
function openKaan(acc: PaperAccount, fill: number, rr: number, mode: 'AGRESIF' | 'AGRESIF_4' | 'GUVENLI_KAR' | 'GUVENLI_ZARAR' = 'AGRESIF', day = D): PaperAccount {
  const stop = fill / 3;
  const rPrice = fill - stop;
  return must(openPosition(acc, { id: 'k', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: day, dte: 0, strike: 100,
    fill, stopPrem: stop, targetPrem: rr * fill, targetR: rr, mode, now: 0, day }));   // 1:N = çıkış/giriş = N (K8)
}
const must = (r: { ok: boolean; reason?: string; acc?: PaperAccount }): PaperAccount => {
  if (!r.ok || !r.acc) throw new Error('beklenmeyen red: ' + (r as any).reason);
  return r.acc;
};
/** Kaan'ın kapanışı: "stop" = giriş/3, "hedef" = 1:R (exit = fill + R × 2/3). */
const closeAt = (acc: PaperAccount, exit: number, reason: 'stop' | 'hedef' | 'risk', day = D) => must(closePosition(acc, exit, reason, 0, day));

// ============ §7.2 Kaan'ın örnekleri (1–8) ============
// 1) Sermaye 300, kademe %50 → pozisyon 150. Prim stopu → R = 100. 1:3 çıkış → +300 → sermaye 600 → sıradaki 300.
{
  let acc = initAccount(300, NOCOST, D);
  acc = openKaan(acc, 1, 3);
  ok('ör.1: pozisyon 150', near(acc.position!.costBasis, 150));
  ok('ör.1: R = 100', near(acc.position!.rDollars, 100), String(acc.position!.rDollars));
  acc = closeAt(acc, 1 + 3 * (2 / 3), 'hedef');
  ok('ör.1: 1:3 çıkış → +300, sermaye 600', near(acc.capital, 600), String(acc.capital));
  ok('ör.1: kazanç sonrası kademe %50 (azami)', acc.kademe === 0.5);
  acc = openKaan(acc, 1, 3);
  ok('ör.1: sıradaki pozisyon 300 (600 × %50)', near(acc.position!.costBasis, 300), String(acc.position!.costBasis));
}
// 1b) Yuvarlamasız formül: primStopMaks = 0,67 → stop = giriş × 0,33 → R = 100,5 (Kaan'ın "100" yuvarlaması; 0,5 $ sapma)
{
  const fill = 1, stop = effectiveStopPrem(fill, 0, PRIM_STOP_MAX);
  ok('ör.1 (0,67 formülü): stop = 0,33', near(stop, 0.33));
  const acc = must(openPosition(initAccount(300, NOCOST, D), { id: 'f', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: D, dte: 0, strike: 100,
    fill, stopPrem: stop, targetPrem: 3, targetR: 3, mode: 'AGRESIF', now: 0, day: D }));
  ok('ör.1 (0,67): R ≈ 100 (±0,6; formül 100,5)', Math.abs(acc.position!.rDollars - 100) <= 0.6, String(acc.position!.rDollars));
}
// 2) Sermaye 300, pozisyon 150, işlem 50'ye düşüp kapandı → sermaye 200 → sıradaki kademe %40 → pozisyon 80.
// NOT (Başkan'a açık çelişki): iki kayıp gün başı sermayenin %51'i → §7.4 "gün içi %50 düşüş → DURDU" (varsayılan açık) devreye girer.
// Kaan'ın ör.3'ü GUVENLI_ZARAR ile devam diyor. Ör.2–3 bu yüzden durdu=kapalı ayarında doğrulanır; DURDU davranışı ayrıca test edilir.
{
  let acc = openKaan(initAccount(300, { ...NOCOST, durduEnabled: false }, D), 1, 3);
  acc = closeAt(acc, 1 / 3, 'stop');
  ok('ör.2: stop → sermaye 200', near(acc.capital, 200), String(acc.capital));
  ok('ör.2: kademe %40', acc.kademe === 0.4);
  acc = openKaan(acc, 1, 3);
  ok('ör.2: pozisyon 80', near(acc.position!.costBasis, 80), String(acc.position!.costBasis));
  // 3) Bir kayıp daha → kademe %30 ve mod GUVENLI_ZARAR (üst üste 2 kayıp)
  acc = closeAt(acc, 1 / 3, 'stop');
  ok('ör.3: kademe %30', acc.kademe === 0.3, String(acc.kademe));
  ok('ör.3: mod GUVENLI_ZARAR', acc.mode === 'GUVENLI_ZARAR', acc.mode);
  ok('ör.3: sermaye 146,67 (80 × 2/3 kayıp)', near(acc.capital, 200 - 80 * 2 / 3, 1e-6), String(acc.capital));
  // Aynı sayılar, DURDU varsayılanı açıkken: gün içi düşüş 153 ≥ 150 → DURDU (çelişki belgelendi)
  let on = openKaan(initAccount(300, { ...NOCOST, durduEnabled: true }, D), 1, 3);
  on = closeAt(on, 1 / 3, 'stop');
  on = closeAt(openKaan(on, 1, 3), 1 / 3, 'stop');
  ok('ör.3 (DURDU açık): gün içi %51 düşüş → DURDU (Başkan kararı bekleniyor)', on.mode === 'DURDU', on.mode);
}
// 4) Günde üst üste 4 kazanç → mod GUVENLI_KAR, kademe kurala göre (azami %50)
{
  let acc = initAccount(300, NOCOST, D);
  for (let i = 0; i < 3; i++) acc = closeAt(openKaan(acc, 1, 3), 2, 'hedef');   // 1:1 kazanç (+ her seferinde)
  ok('ör.4: 3 kazanç → hâlâ AGRESIF', acc.mode === 'AGRESIF', acc.mode);
  acc = closeAt(openKaan(acc, 1, 3), 2, 'hedef');
  ok('ör.4: 4 kazanç → GUVENLI_KAR', acc.mode === 'GUVENLI_KAR', acc.mode);
  ok('ör.4: kademe azami %50', acc.kademe === 0.5);
}
// 5) Hiçbir durumda pozisyon > sermaye × %50 (özellik testi, 10.000 rastgele işlem, iki kip)
for (const fractional of [true, false]) {
  let seed = 20261113;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let acc = initAccount(300, { fractional }, D), opened = 0, worst = 0, badK = false, bad = false;
  for (let step = 0; step < 10000; step++) {
    // Rastgele akışta sermaye zamanla erir; her 50 adımda 300 ile yeniden başlayıp farklı kademe/sermaye durumları sınanır.
    if (step % 50 === 0) acc = initAccount(300, { fractional }, D);
    if (rnd() < 0.2) acc = startDay(acc, `2026-12-${String((step % 28) + 1).padStart(2, '0')}`);
    const fill = 0.05 + rnd() * (fractional ? 3 : 1.2);
    const r = openPosition(acc, { id: String(step), ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: acc.day, dte: 0, strike: 1,
      fill, stopPrem: fill / 3, targetPrem: fill * 3, targetR: 3, mode: 'AGRESIF', now: step, day: acc.day });
    if (!r.ok) continue;
    opened++;
    const p = r.acc.position!;
    worst = Math.max(worst, p.costBasis / acc.capital);
    if (p.costBasis > acc.capital * 0.5 + 1e-9) bad = true;
    if (!KADEMELER.includes(r.acc.kademe)) badK = true;
    const exit = rnd() < 0.45 ? fill / 3 : rnd() < 0.5 ? fill : fill * (1 + 3 * rnd());
    const c = closePosition(r.acc, exit, 'manuel', step, acc.day);
    if (c.ok) acc = c.acc;
  }
  ok(`özellik: pozisyon ≤ sermaye × %50 (${fractional ? 'kesirli' : 'tam kontrat'}, ${opened} işlem)`, !bad && opened > 1000, `en kötü oran ${worst.toFixed(3)}`);
  ok(`özellik: kademe hep {30,40,50}`, !badK);
}
// 6) Kademe dönüşü: %30 kazanç → %40; kazanç → %50; kazanç → %50. %40 kazanç → %50.
ok('ör.6: 30 →(kazanç) 40', kademeAfter(0.3, 'kazanc') === 0.4);
ok('ör.6: 40 →(kazanç) 50', kademeAfter(0.4, 'kazanc') === 0.5);
ok('ör.6: 50 →(kazanç) 50 (azami)', kademeAfter(0.5, 'kazanc') === 0.5);
ok('ör.6: 40 →(kazanç) 50', kademeAfter(0.4, 'kazanc') === 0.5);
ok('kademe: kayıp 50 → 40, 40 → 30, 30 → 30 (en az %30)', kademeAfter(0.5, 'kayip') === 0.4 && kademeAfter(0.4, 'kayip') === 0.3 && kademeAfter(0.3, 'kayip') === 0.3);
ok('kademe: başabaş değişmez', kademeAfter(0.4, 'basabas') === 0.4);
// 7) Gün geçişi: gün %30 kademede kapandı → ertesi gün %30 ile başlar (AGRESIF, sayaçlar 0). Kazançla %40.
{
  let acc = initAccount(300, NOCOST, D);
  acc = closeAt(openKaan(acc, 1, 3), 1 / 3, 'stop');     // 50 → 40
  acc = closeAt(openKaan(acc, 1, 3), 1 / 3, 'stop');     // 40 → 30, GUVENLI_ZARAR
  const next = startDay(acc, '2026-11-16');
  ok('ör.7: ertesi gün mod AGRESIF', next.mode === 'AGRESIF', next.mode);
  ok('ör.7: ertesi gün kademe %30 taşınır', next.kademe === 0.3);
  ok('ör.7: ertesi gün sayaçlar 0', next.winStreak === 0 && next.lossStreak === 0);
  ok('ör.7: ertesi gün başlangıç sermayesi = devreden sermaye', near(next.dayStartCapital, acc.capital));
  const w = closeAt(openKaan(next, 1, 3, 'AGRESIF', '2026-11-16'), 3, 'hedef', '2026-11-16');
  ok('ör.7: kazançla kademe %40', w.kademe === 0.4, String(w.kademe));
}
// 8) Komisyon: ask 0,80, pozisyon 150 → adet = floor(150 / (80 + 1,50)) = 1; çıkış 2,40 → net K/Z 157.
{
  const acc0 = initAccount(300, { commission: DEFAULT_COMMISSION, slippage: 0, fractional: false }, D);
  const acc = must(openPosition(acc0, { id: 'c', ticker: 'NVDA', setup: 'S3', dir: 'call', expiry: D, dte: 0, strike: 1,
    fill: 0.80, stopPrem: 0.3, targetPrem: 2.4, targetR: 5, mode: 'AGRESIF', now: 0, day: D }));
  ok('ör.8: adet 1', acc.position!.contracts === 1, String(acc.position!.contracts));
  const c = must(closePosition(acc, 2.40, 'hedef', 0, D));
  ok('ör.8: net K/Z = 157', near(c.trades[0].netPnl, 157), String(c.trades[0].netPnl));
  ok('ör.8: sermaye 457', near(c.capital, 457));
}

// ============ §6.1 Kaan'ın R / hedef örnekleri ============
{
  // K8 (onaylı): 1:N = çıkış primi / giriş primi. 150 ile gir, 750 ile çık → kazanç 600 (= 6R; R = 100).
  const acc = openKaan(initAccount(300, NOCOST, D), 1, 5);
  const c = closeAt(acc, 5, 'hedef');
  ok('K8: 1:5 hedef: 150 → 750, kazanç +600', near(c.trades[0].netPnl, 600), String(c.trades[0].netPnl));
  ok('K8: 1:5 kazanç = 6R (R = 100)', near(c.trades[0].rMultiple, 6, 1e-6), String(c.trades[0].rMultiple));
  ok('K8: sermaye 300 → 900', near(c.capital, 900), String(c.capital));
  ok('K8: zarar 150 → 50 (−100 = −1R)', near(closeAt(openKaan(initAccount(300, NOCOST, D), 1, 5), 1 / 3, 'stop').trades[0].netPnl, -100));
}

// ============ Komisyon ve maliyet ============
ok('aracı komisyonları: Midas 1,50, IBKR 0,65', BROKER_COMMISSION.midas === 1.5 && BROKER_COMMISSION.ibkr === 0.65);
ok('giriş dolumu = ask + 0,01', near(entryFill(0.80), 0.81));
ok('çıkış dolumu = bid − 0,01', near(exitFill(2.40), 2.39));
ok('ask ≤ 0,05 alınmaz', !isTradable(0.05) && isTradable(0.06));
ok('gecikmeli giriş: max(gecikmeli ask, model + yarım spread)', near(delayedEntryAsk(0.80, 0.85, 0.02), 0.87) && near(delayedEntryAsk(0.90, 0.85, 0.02), 0.90));
ok('net K/Z formülü (komisyon açılış+kapanış)', near(netPnl(0.8, 2.4, 1, 1.5), 157));
ok('kesir kapalı: floor', sizePosition(300, 0.5, 0.8, { commission: 1.5 }).contracts === 1);
ok('sermaye yetmez → 0 adet', sizePosition(100, 0.3, 0.8, { commission: 1.5 }).contracts === 0);
ok('bütçe = sermaye × kademe', near(budgetFor(300, 0.4), 120));
ok('maliyet her zaman bütçeden küçük/eşit', (() => { for (let f = 0.05; f < 4; f += 0.037) { const s = sizePosition(333, 0.5, f); if (s.cost > s.budget + 1e-9) return false; } return true; })());

// ============ Durum geçiş tablosu (mod × olay) ============
const base = { winStreak: 0, lossStreak: 0, dayPnl: 0, dayStartCapital: 300, lossLandedAt30: false, durduEnabled: true };
const table: [string, PaperAccount['mode'], Partial<typeof base>, string][] = [
  ['AGRESIF + kazanç(1)', 'AGRESIF', { winStreak: 1 }, 'AGRESIF'],
  ['AGRESIF + 4 kazanç', 'AGRESIF', { winStreak: 4 }, 'GUVENLI_KAR'],
  ['GUVENLI_KAR + kayıp(1)', 'GUVENLI_KAR', { lossStreak: 1 }, 'GUVENLI_KAR'],
  ['GUVENLI_KAR + 2 kayıp', 'GUVENLI_KAR', { lossStreak: 2 }, 'GUVENLI_ZARAR'],
  ['AGRESIF + kademe 30\'a inen kayıp', 'AGRESIF', { lossStreak: 1, lossLandedAt30: true }, 'GUVENLI_ZARAR'],
  ['GUVENLI_ZARAR + kazanç (yapışkan)', 'GUVENLI_ZARAR', { winStreak: 1 }, 'GUVENLI_ZARAR'],
  ['GUVENLI_ZARAR + 4 kayıp', 'GUVENLI_ZARAR', { lossStreak: 4 }, 'DURDU'],
  ['DURDU + kazanç (gün sonuna kadar)', 'DURDU', { winStreak: 1 }, 'DURDU'],
  ['AGRESIF + %50 gün içi düşüş', 'AGRESIF', { lossStreak: 1, dayPnl: -150 }, 'DURDU'],
  ['AGRESIF + %50 düşüş, DURDU kapalı', 'AGRESIF', { lossStreak: 1, dayPnl: -150, durduEnabled: false }, 'AGRESIF'],
  ['AGRESIF + 4 kayıp, DURDU kapalı', 'AGRESIF', { lossStreak: 4, durduEnabled: false }, 'GUVENLI_ZARAR'],
];
for (const [name, prev, over, exp] of table) {
  const got = nextMode(prev, { ...base, ...over });
  ok(`geçiş: ${name} → ${exp}`, got === exp, `alınan ${got}`);
}
// Başabaş: sayaçları ve kademeyi değiştirmez
{
  const acc = closeAt(openKaan(initAccount(300, NOCOST, D), 1, 3), 1 / 3, 'stop');   // 1 kayıp → kademe 40
  const opened = openKaan(acc, 1, 3);
  const be = closeAt(opened, 1, 'stop');                                           // çıkış = giriş → net 0
  ok('başabaş: lossStreak değişmez', be.lossStreak === 1, String(be.lossStreak));
  ok('başabaş: kademe değişmez', be.kademe === acc.kademe);
  ok('başabaş: sermaye değişmez', near(be.capital, acc.capital));
  ok('sınıflandırma: |net| < %2 → başabaş', classify(1.9, 100) === 'basabas' && classify(2.1, 100) === 'kazanc' && classify(-2.1, 100) === 'kayip');
}
// Gece kapanışı: sayaç kapanış gününe yazılır
{
  let acc = openKaan(initAccount(300, NOCOST, D), 1, 3);
  acc = closeAt(acc, 1 / 3, 'stop', '2026-11-16');
  ok('gece: kayıp kapanış gününe yazıldı (gün 16 Kas, lossStreak 1)', acc.day === '2026-11-16' && acc.lossStreak === 1);
  ok('gece: dayPnl yalnız kapanış günü', near(acc.dayPnl, -100));
}
// DURDU: 4 kayıp → yeni pozisyon açılmaz
{
  let acc = initAccount(300, { ...NOCOST, durduEnabled: true }, D);
  // küçük kayıplar (%10 prim düşüşü): gün içi düşüş kuralını tetiklemeden 4 üst üste kayıp
  for (let i = 0; i < 4; i++) acc = closeAt(openKaan(acc, 1, 3), 0.9, 'stop');
  ok('DURDU: 4 üst üste kayıp → mod DURDU', acc.mode === 'DURDU', acc.mode);
  const r = openPosition(acc, { id: 'x', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: D, dte: 0, strike: 1, fill: 1, stopPrem: 0.3, targetPrem: 3, targetR: 3, mode: 'AGRESIF', now: 0, day: D });
  ok('DURDU: yeni pozisyon reddedilir', !r.ok && r.reason === 'bugünlük durdu');
}
ok('tek açık pozisyon kuralı', (() => { const a = openKaan(initAccount(300, NOCOST, D), 1, 3); const r = openPosition(a, { id: 'y', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: D, dte: 0, strike: 1, fill: 1, stopPrem: 0.3, targetPrem: 3, targetR: 3, mode: 'AGRESIF', now: 0, day: D }); return !r.ok && r.reason === 'açık pozisyon var'; })());
// Gün içi %50 düşüş (iki kayıp, komisyon 0): DURDU önceliği
{
  let acc = initAccount(300, { ...NOCOST, durduEnabled: true }, D);
  acc = closeAt(openKaan(acc, 1, 3), 1 / 3, 'stop');     // −100 → 200
  acc = closeAt(openKaan(acc, 1, 3), 1 / 3, 'stop');     // −53,3 → gün içi düşüş 153,3 ≥ 150
  ok('DURDU: gün içi düşüş ≥ %50 (öncelik DURDU > GUVENLI_ZARAR)', acc.mode === 'DURDU', acc.mode);
}

// ============ Sinyal modu ve seçim ============
ok('1:5 → AGRESIF', signalModeFor('AGRESIF', 5) === 'AGRESIF');
ok('1:4,2 → AGRESIF_4 (1:5 yoksa)', signalModeFor('AGRESIF', 4.2) === 'AGRESIF_4');
ok('1:3 → yok (Agresif modda giriş yok)', signalModeFor('AGRESIF', 3) === null);
ok('güvenli: 1:2 ve 1:1,5 kabul', signalModeFor('GUVENLI_KAR', 1.6) === 'GUVENLI_KAR' && signalModeFor('GUVENLI_ZARAR', 2.1) === 'GUVENLI_ZARAR');
ok('DURDU: hiçbir sinyal', signalModeFor('DURDU', 9) === null);
// K9 (onaylı): DURDU varsayılan kapalı; aynı 4 küçük kayıp varsayılanda DURDU'ya değil GUVENLI_ZARAR'a gider.
{
  let acc = initAccount(300, NOCOST, D);
  for (let i = 0; i < 4; i++) acc = closeAt(openKaan(acc, 1, 3), 0.9, 'stop');
  ok('K9: DURDU varsayılan kapalı (ayar)', initAccount(300).settings.durduEnabled === false);
  ok('K9: varsayılanda 4 kayıp → GUVENLI_ZARAR (DURDU değil)', acc.mode === 'GUVENLI_ZARAR', acc.mode);
}
ok('skor eşiği: AGRESIF 65', eligibility('AGRESIF', 5, 64).ok === false && eligibility('AGRESIF', 5, 65).ok === true);
ok('skor eşiği: GUVENLI_ZARAR 75', eligibility('GUVENLI_ZARAR', 2, 74).ok === false && eligibility('GUVENLI_ZARAR', 2, 75).ok === true);
ok('min RR/skor tablosu: AGRESIF 5/65, GUVENLI_ZARAR 1,5/75', MODE_RULES.AGRESIF.minRR === 5 && MODE_RULES.GUVENLI_ZARAR.minScore === 75 && MODE_RULES.GUVENLI_ZARAR.minRR === 1.5);
{
  const c = chooseCandidate('AGRESIF', [{ rr: 4.5, score: 90 }, { rr: 5.2, score: 66 }]);
  ok('seçim: 1:5 (66) 1:4 (90)\'a tercih edilir', c !== null && c.cand.rr === 5.2 && c.mode === 'AGRESIF', JSON.stringify(c));
  const d = chooseCandidate('AGRESIF', [{ rr: 4.5, score: 90 }]);
  ok('seçim: 1:5 yoksa 1:4 (AGRESIF_4)', d !== null && d.mode === 'AGRESIF_4');
  ok('seçim: hiç uygun yoksa null', chooseCandidate('AGRESIF', [{ rr: 2, score: 99 }]) === null);
}

// ============ Hedef R ve eşikler ============
ok('mod hedefi: AGRESIF 5, AGRESIF_4 4, güvenli 2 / 1,5', modeTargetR('AGRESIF', 9) === 5 && modeTargetR('AGRESIF_4', 9) === 4
  && modeTargetR('GUVENLI_KAR', 2.1) === 2 && modeTargetR('GUVENLI_KAR', 1.6) === 1.5);
ok('çıkış eşiği: normal 2R, güvenli 1R', exitThresholdR('AGRESIF') === 2 && exitThresholdR('GUVENLI_KAR') === 1);

// ============ Risk izleyici T1–T7 ============
const bar = (o: number, h: number, l: number, c: number): Bar => ({ t: 0, o, h, l, c, v: 1 });
ok('T1: ters gövde ≥ %60 + hacim ≥ 2 → tetik (call pozisyonda kırmızı mum)', t1ReversalCandle(bar(10, 10.05, 9.0, 9.1), 1, 2.5));
ok('T1: hacim 1,5 → tetik yok', !t1ReversalCandle(bar(10, 10.05, 9.0, 9.1), 1, 1.5));
ok('T1: gövde/aralık < 0,6 → yok', !t1ReversalCandle(bar(10, 10.5, 9.5, 9.9), 1, 3));
ok('T1: pozisyonla aynı yönde mum → yok', !t1ReversalCandle(bar(9.6, 10.5, 9.5, 10), 1, 3));
ok('T2: VWAP ters kapanış', t2VwapLoss(99.9, 100, 1) && !t2VwapLoss(100.1, 100, 1) && t2VwapLoss(100.1, 100, -1));
ok('T3: rejim pozisyonun ters tarafında', t3RegimeFlip(-1, 1) && !t3RegimeFlip(1, 1) && !t3RegimeFlip(null, 1));
ok('T4: yeni tepe + RSI ve hacim düşüşü', t4MomentumDivergence(true, 60, 65, 1, 2) && !t4MomentumDivergence(false, 60, 65, 1, 2));
ok('T5: IV ≥ %15 düştü ve prim artmadı', t5IvDrop(0.5, 0.42, 1, 1.1) && !t5IvDrop(0.5, 0.45, 1, 1.1) && !t5IvDrop(0.5, 0.42, 1.2, 1.1));
ok('T6: 0DTE, 60 dk < kalan, hedefe > 0,3 EMr', t6Theta(0, 50, 2, 5) && !t6Theta(1, 50, 2, 5) && !t6Theta(0, 90, 2, 5));
ok('T7: seviyeye ≤ 0,1 EM + fitilli ret', t7KeyLevel(100.05, 100, 1, true) && !t7KeyLevel(100.5, 100, 1, true) && !t7KeyLevel(100, 100, 1, false));

const pos = (over: Partial<OpenPosition> = {}): OpenPosition => ({
  id: 'p', ticker: 'QQQ', setup: 'S1', dir: 'call', expiry: D, dte: 0, strike: 100, contracts: 1.5, fill: 1, costBasis: 150,
  openComm: 0, stopPrem0: 1 / 3, stopPrem: 1 / 3, targetPrem: 3, rPrice: 2 / 3, rDollars: 100, targetR: 3, openedAt: 0, day: D,
  mode: 'AGRESIF', kademe: 0.5, overnight: false, maxR: 0, warned: false, ...over,
});
const bidR = (R: number) => 1 + R * (2 / 3);   // R katı kâr için bid
const T = (over: Record<string, boolean>, bid: number, mode: 'AGRESIF' | 'GUVENLI_KAR' = 'AGRESIF', etMin = 600) =>
  ({ bid, etMin, mode, flags: over as any });

ok('R ölçümü: bid 1 + 2R·(2/3) → 2R', near(profitR(pos(), bidR(2)), 2));
{
  const d = evaluatePosition(pos(), T({ T2: true }, bidR(2.5)));
  ok('risk: kâr 2,5R + güçlü tetik → çık (risk)', d.action === 'close' && d.reason === 'risk', JSON.stringify(d.action));
}
{
  const d1 = evaluatePosition(pos(), T({ T2: true }, bidR(1.5)));
  ok('risk: kâr 1,5R + güçlü tetik → uyarı, stop girişe', d1.action === 'warn' && d1.pos.stopPrem === 1 && d1.pos.warned);
  const d2 = evaluatePosition(d1.pos, T({ T2: true }, bidR(1.4)));
  ok('risk: ikinci tetikte çıkış', d2.action === 'close' && d2.reason === 'risk');
  const dw = evaluatePosition(pos(), T({ T4: true }, bidR(1.5)));
  ok('risk: 1 zayıf tetik (1R–2R) → yalnız bekle', dw.action === 'hold');
  const dz = evaluatePosition(pos(), T({ T4: true, T5: true }, bidR(1.5)));
  ok('risk: 2 zayıf tetik (1R–2R) → uyarı', dz.action === 'warn');
}
{
  ok('risk: güvenli modda eşik 1R → 1,2R güçlü tetikte çık', evaluatePosition(pos({ mode: 'GUVENLI_KAR' }), T({ T1: true }, bidR(1.2), 'GUVENLI_KAR')).action === 'close');
  ok('risk: 2 zayıf, kâr 0,5R → tetik yok sayılır (hold)', evaluatePosition(pos(), T({ T6: true, T7: true }, bidR(0.5))).action === 'hold');
}
ok('risk: 1 zayıf tetik tek başına çıkarmaz (2R altı)', evaluatePosition(pos(), T({ T5: true }, bidR(2.5))).action === 'hold');
ok('risk: 2 zayıf tetik kâr ≥2R → çıkar', evaluatePosition(pos(), T({ T5: true, T7: true }, bidR(2.2))).action === 'close');
// İz süren stop: maxR 2 → +1R, 3 → +2R, 4 → +3R
ok('iz süren: maxR 2 → kilit +1R', near(trailPrem(pos(), 2), 1 + 2 / 3));
ok('iz süren: maxR 3 → kilit +2R', near(trailPrem(pos(), 3), 1 + 4 / 3));
ok('iz süren: maxR 4 → kilit +3R', near(trailPrem(pos(), 4), 1 + 2));
ok('iz süren: maxR 1,9 → kilit yok', near(trailPrem(pos(), 1.9), 1 / 3));
{
  const up = evaluatePosition(pos(), T({}, bidR(2.5)));            // maxR 2,5 → stop +1R
  ok('iz süren stop: 2,5R görüldü → stop +1R', near(up.pos.stopPrem, 1 + 2 / 3, 1e-9));
  const hit = evaluatePosition(up.pos, T({}, 1.6));                // stop 1,67 altına düştü (bid 1,6)
  ok('iz süren stop: vurdu → çıkış iz-suren-stop', hit.action === 'close' && hit.reason === 'iz-suren-stop');
}
ok('stop: giriş/3 altına düştü → çıkış stop', (() => { const d = evaluatePosition(pos(), T({}, 0.3)); return d.action === 'close' && d.reason === 'stop'; })());
ok('hedef: bid ≥ hedef → çıkış hedef', (() => { const d = evaluatePosition(pos(), T({}, 3.1)); return d.action === 'close' && d.reason === 'hedef'; })());
ok('0DTE 15:45 ET zorunlu zaman çıkışı', (() => { const d = evaluatePosition(pos({ dte: 0 }), T({}, bidR(0.5), 'AGRESIF', 945)); return d.action === 'close' && d.reason === 'zaman'; })());
ok('effectiveStopPrem: dayanak 0,2 < %67 tavanı 0,33 → 0,33', near(effectiveStopPrem(1, 0.2, 0.67), 0.33));

// ============ Onay akışı (§7.7) ============
ok('süre: 0DTE 3 dk, 1–3 DTE 5 dk, ayar 7 dk, 0 → 1 dk (kıstırma)', approvalTtlMs(0) === 180000 && approvalTtlMs(2) === 300000
  && approvalTtlMs(0, 7) === 420000 && approvalTtlMs(0, 0) === 60000 && approvalTtlMs(0, 99) === 600000);
const sig: ApprovalSignal = { createdAt: 0, dte: 0, dirSign: 1, spot0: 100.0, entryUnd: 100, stopUnd: 98, targetUnd: 104,
  ask0: 1.0, mode: 'AGRESIF', windowEndMin: 870 };
const tick = (over: Partial<ApprovalTick> = {}): ApprovalTick => ({ now: 60000, spot: 100.1, etMin: 600, marketOpen: true,
  fresh: { score: 70, rr: 5, minScore: 65, minRR: 5 }, ...over });
ok('onay: süre dolumu (0DTE 3 dk)', expiryReason(sig, tick({ now: 180000 }), approvalTtlMs(0)) === 'zaman');
ok('onay: süre içindeyken, kayma yok → null', expiryReason(sig, tick(), approvalTtlMs(0)) === null);
ok('onay: fiyat kayması > %25 × (giriş − stop) → süre dolar', expiryReason(sig, tick({ spot: 100.6 }), approvalTtlMs(0)) === 'fiyat-kaymasi');
ok('onay: dayanak stopa dokundu (kayma eşiği içinde)', (() => { const s2 = { ...sig, spot0: 98.2 }; return expiryReason(s2, tick({ spot: 97.95 }), approvalTtlMs(0)) === 'stop-dokunusu'; })());
ok('onay: giriş-hedef yarısına ulaştı', (() => { const s2 = { ...sig, spot0: 101.9 }; return expiryReason(s2, tick({ spot: 102.1 }), approvalTtlMs(0)) === 'hedef-yarisi'; })());
ok('onay: pencere bitti (14:30 veto)', expiryReason(sig, tick({ etMin: 870 }), approvalTtlMs(0)) === 'pencere-kapandi');
ok('onay: piyasa kapalı', expiryReason(sig, tick({ marketOpen: false }), approvalTtlMs(0)) === 'pencere-kapandi');
ok('onay: yeni tarama geçersiz kıldı (skor < mod)', expiryReason(sig, tick({ fresh: { score: 60, rr: 5, minScore: 65, minRR: 5 } }), approvalTtlMs(0)) === 'gecersizlesti');
ok('onay: yeni tarama RR alt sınırın altına', expiryReason(sig, tick({ fresh: null }), approvalTtlMs(0)) === 'gecersizlesti');
ok('onaya basınca: ask 1,09 (≤ %10 artış) → dolum 1,10', (() => { const r = repriceOnApprove({ ask0: 1 }, { ask: 1.09, rr: 5, minRR: 5 }); return r.ok && near(r.fill, 1.10); })());
ok('onaya basınca: ask 1,11 (> %10) → fiyat kaçtı', (() => { const r = repriceOnApprove({ ask0: 1 }, { ask: 1.11, rr: 9, minRR: 5 }); return !r.ok && r.reason === 'fiyat-kacti'; })());
ok('onaya basınca: yeni RR < mod alt sınırı → fiyat kaçtı', (() => { const r = repriceOnApprove({ ask0: 1 }, { ask: 1.0, rr: 4.9, minRR: 5 }); return !r.ok; })());
ok('karar: Geç → reddedildi (hesap değişmez)', resolveApproval('bekliyor', 'gec', null, null).state === 'reddedildi');
ok('karar: süresi dolan + Onayla → suresi-doldu', resolveApproval('bekliyor', 'onayla', 'zaman', null).state === 'suresi-doldu');
ok('karar: yeniden fiyat kaçtı → fiyat-kacti', resolveApproval('bekliyor', 'onayla', null, { ok: false, reason: 'fiyat-kacti', detail: '' }).state === 'fiyat-kacti');
ok('karar: temiz onay → onaylandi', resolveApproval('bekliyor', 'onayla', null, { ok: true, fill: 1.01 }).state === 'onaylandi');

// ============ Gece taşıma (§7.8) ============
ok('takvim: 2026-11-13 Cuma → sonraki işlem günü Pazartesi 16 Kas', nextTradingDay(D) === '2026-11-16');
{
  const s = sigmaNight(100, 0.2, D);
  const expected = 100 * 0.2 * Math.sqrt(65.5 / (365 * 24));           // Cuma 16:00 → Pazartesi 09:30 ET ≈ 65,5 saat
  ok('σ_gece: Cuma → Pazartesi ≈ 65,5 saat (hafta sonu)', near(s, expected, 1e-6), String(s));
}
const ovPos = (over: Partial<OpenPosition> = {}) => pos({ dte: 2, expiry: '2026-11-18', contracts: 1.5, costBasis: 150, rDollars: 100, ...over });
const ovIn = (over: Record<string, any> = {}) => ({ pos: ovPos(), day: D, S: 100, ivAtm: 0.2, eventBeforeOpen: false,
  strongTriggerLast30: false, regimeAligned: true, pricer: () => 0.6, ...over });
{
  const d = overnightDecision(ovIn());
  // kötü senaryo: değer 0,6 × 100 × 1,5 = 90 → kayıp 150 − 90 = 60 → 0,6R
  ok('gece: tüm koşullar sağlanır → taşınır (kötü senaryo 0,6R)', d.carry && near(d.badR, 0.6), JSON.stringify(d));
  ok('gece: bilanço/makro → taşınmaz', !overnightDecision(ovIn({ eventBeforeOpen: true })).carry);
  ok('gece: son 30 dk güçlü tetik → taşınmaz', !overnightDecision(ovIn({ strongTriggerLast30: true })).carry);
  ok('gece: rejim pozisyon yönünde değil → taşınmaz', !overnightDecision(ovIn({ regimeAligned: false })).carry);
  ok('gece: 0DTE → taşınmaz (15:45 kapanır)', !overnightDecision(ovIn({ pos: ovPos({ dte: 0, expiry: D }) })).carry);
  ok('gece: vade ertesi seanstan önce (vade 13 Kas, ertesi 16 Kas) → taşınmaz', !overnightDecision(ovIn({ pos: ovPos({ expiry: D, dte: 1 }) })).carry);
  const bad = overnightDecision(ovIn({ pricer: () => 0 }));                     // kayıp 150 / R 100 = 1,5R → sınır (taşınır)
  ok('gece: kötü senaryo tam 1,5R → taşınır', bad.carry && near(bad.badR, 1.5), String(bad.badR));
  const worse = overnightDecision(ovIn({ pos: ovPos({ rDollars: 90 }), pricer: () => 0 }));   // 150 / 90 = 1,67R
  ok('gece: kötü senaryo > 1,5R → taşınmaz', !worse.carry && worse.reasons.some(r => r.includes('kötü senaryo')));
}
ok('gap: açılış dayanak stopunun ötesinde → gap çıkışı', gapOpenAction({ pos: ovPos(), openUnd: 97.5, openBid: 1.2, stopUnd: 98, etMin: 571 }, 1).action === 'gap-close');
ok('gap: prim %67 tavanının altında açıldı → gap çıkışı', gapOpenAction({ pos: ovPos({ stopPrem: 0.4 }), openUnd: 100, openBid: 0.3, stopUnd: 98, etMin: 571 }, 1).action === 'gap-close');
ok('gap: 09:31 açılış gürültüsü → bekle (T1–T7 devre dışı)', gapOpenAction({ pos: ovPos(), openUnd: 100.5, openBid: 1.5, stopUnd: 98, etMin: 575 }, 1).action === 'wait');
ok('gap: 09:45 sonrası lehte → iz süren yönet', gapOpenAction({ pos: ovPos(), openUnd: 101, openBid: 1.8, stopUnd: 98, etMin: 600 }, 1).action === 'manage');

// ============ Özet istatistik (§7.6) ============
{
  let acc = initAccount(300, NOCOST, D);
  acc = closeAt(openKaan(acc, 1, 3), 3, 'hedef');   // +300
  acc = closeAt(openKaan(acc, 1, 3), 1 / 3, 'stop'); // kayıp
  const s = summarize(acc.trades);
  ok('özet: n=2, kazanma %50, PF = 300/(kayıp)', s.n === 2 && near(s.winPct, 50) && s.pf > 0 && s.longestLossStreak === 1, JSON.stringify(s));
}

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nKâğıt hesap testleri geçti'); process.exit(fail ? 1 : 0);
