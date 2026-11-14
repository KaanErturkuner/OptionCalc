/* Kâğıt hesap durum makinesi (saf) — SINYAL-FIRSAT §7.1, §7.4, §7.6.
 * Her fonksiyon girdi durumu DEĞİŞTİRMEZ; yeni durum ya da hata döner. Gerçek emir yok. */
import type { PaperAccount, PaperMode, PaperSettings, OpenPosition, ClosedTrade, ExitReason, TradeResult } from './types.ts';
import { START_KADEME, kademeAfter, sizePosition } from './sizing.ts';
import { DEFAULT_COMMISSION, DEFAULT_SLIPPAGE, netPnl } from './costs.ts';

// ---- sabitler (Kaan kuralları + §7.4 varsayımları) ----
export const WIN_STREAK_KAR = 4;         // gün içi 4 kazanç → GUVENLI_KAR
export const LOSS_STREAK_ZARAR = 2;      // üst üste 2 kayıp → GUVENLI_ZARAR (Kaan kararı D12)
export const SAFE_LOSS_DURDU = 2;        // GUVENLI_ZARAR'a girdikten sonra üst üste 2 kayıp daha → DURDU (Kaan kararı D12, varsayılan AÇIK)
export const BREAKEVEN_PCT = 0.02;       // |net K/Z| < pozisyonun %2'si → başabaş
export const TRADE_KEEP = 500;

/** Mod kuralları (§7.1). Sinyal seçimi: AGRESIF 1:5 → 1:4 (AGRESIF_4) → 1:3 (AGRESIF_3); güvenli modlarda 1:2 → 1:1,5. */
export const MODE_RULES: Record<'AGRESIF' | 'AGRESIF_4' | 'AGRESIF_3' | 'GUVENLI_KAR' | 'GUVENLI_ZARAR', { minRR: number; minScore: number }> = {
  AGRESIF: { minRR: 5, minScore: 65 },
  AGRESIF_4: { minRR: 4, minScore: 65 },
  AGRESIF_3: { minRR: 3, minScore: 65 },
  GUVENLI_KAR: { minRR: 1.5, minScore: 70 },
  GUVENLI_ZARAR: { minRR: 1.5, minScore: 75 },
};

export type Result<T = PaperAccount> = { ok: true; acc: T } | { ok: false; reason: string };
/** Sinyal etiketi: DURDU hiçbir sinyale uygulanmaz. */
export type SignalMode = Exclude<PaperMode, 'DURDU'>;

export function initAccount(startCapital: number, over: Partial<PaperSettings> = {}, day = ''): PaperAccount {
  const settings: PaperSettings = {
    // DURDU varsayılan AÇIK (Kaan kararı D12, 2026-11-13). Ayarla kapatılabilir.
    startCapital, fractional: false, commission: DEFAULT_COMMISSION, slippage: DEFAULT_SLIPPAGE, durduEnabled: true, ...over,
  };
  return {
    capital: startCapital, kademe: START_KADEME, mode: 'AGRESIF', winStreak: 0, lossStreak: 0, safeLossStreak: 0,
    day, dayStartCapital: startCapital, dayPnl: 0, position: null, trades: [], settings,
  };
}

/** Net K/Z sınıfı (§7.4): |net| < %2 pozisyon → başabaş. */
export function classify(net: number, costBasis: number): TradeResult {
  if (Math.abs(net) < BREAKEVEN_PCT * costBasis) return 'basabas';
  return net > 0 ? 'kazanc' : 'kayip';
}

/** Kayıt şema sürümü: 2 = DURDU açık (D12). Şema 1 kayıtlarda DURDU varsayılan kapalıydı; bir kere açılır. */
export const FIRSAT_SCHEMA = 3;   // 3: Q ayarları (firsat store); paper migrasyonu yalnız şema < 2 için DURDU'yu açar
export function migrateSettings(s: PaperSettings, schema: number): PaperSettings {
  return schema < 2 ? { ...s, durduEnabled: true } : s;
}

/** Gün geçişi (09:30 ET): mod AGRESIF, ardışık sayaçlar ve gün başı sermaye sıfırlanır. Kademe ve açık pozisyon taşınır (§7.4). */
export function startDay(acc: PaperAccount, day: string): PaperAccount {
  if (acc.day === day) return acc;
  return { ...acc, day, mode: 'AGRESIF', winStreak: 0, lossStreak: 0, safeLossStreak: 0, dayStartCapital: acc.capital, dayPnl: 0 };
}

/** Hesap modu geçişi. Öncelik: DURDU > GUVENLI_ZARAR > GUVENLI_KAR > AGRESIF. Mod gün sonuna kadar yapışkandır. */
export function nextMode(prev: PaperMode, s: {
  winStreak: number; lossStreak: number; safeLossStreak: number; durduEnabled: boolean;
}): PaperMode {
  // safeLossStreak: GUVENLI_ZARAR'a girişten sonraki ardışık kayıplar (kazanç sıfırlar, başabaş değiştirmez).
  if (prev === 'DURDU' || (s.durduEnabled && prev === 'GUVENLI_ZARAR' && s.safeLossStreak >= SAFE_LOSS_DURDU)) return 'DURDU';
  if (prev === 'GUVENLI_ZARAR' || s.lossStreak >= LOSS_STREAK_ZARAR) return 'GUVENLI_ZARAR';
  if (prev === 'GUVENLI_KAR' || s.winStreak >= WIN_STREAK_KAR) return 'GUVENLI_KAR';
  return 'AGRESIF';
}

/** Sinyal modu: hesap modu + sinyalin R'si → etiket. Uygun değilse null ("1:4 de yoksa işlem yok"). */
export function signalModeFor(accMode: PaperMode, rr: number): SignalMode | null {
  if (accMode === 'DURDU') return null;
  if (accMode === 'AGRESIF') {
    if (rr >= MODE_RULES.AGRESIF.minRR) return 'AGRESIF';
    if (rr >= MODE_RULES.AGRESIF_4.minRR) return 'AGRESIF_4';
    if (rr >= MODE_RULES.AGRESIF_3.minRR) return 'AGRESIF_3';
    return null;
  }
  return rr >= MODE_RULES[accMode].minRR ? accMode : null;
}

/** Sinyal uygun mu? (mod + skor + RR). Gerekçe Türkçe. */
export function eligibility(accMode: PaperMode, rr: number, score: number): { ok: true; mode: SignalMode } | { ok: false; reason: string } {
  const mode = signalModeFor(accMode, rr);
  if (accMode === 'DURDU') return { ok: false, reason: 'bugünlük durdu' };
  if (!mode) return { ok: false, reason: accMode === 'AGRESIF' ? 'RR yetersiz (1:5 veya 1:4 yok)' : 'RR yetersiz (1:2 veya 1:1,5 yok)' };
  const minScore = MODE_RULES[mode].minScore;
  if (score < minScore) return { ok: false, reason: `skor ${score} < ${minScore}` };
  return { ok: true, mode };
}

/** Aynı taramadaki adaylardan seç: önce 1:5 (AGRESIF), 1:4, güvenli modda önce 1:2; sonra skor, sonra RR. */
export function chooseCandidate<T extends { rr: number; score: number }>(accMode: PaperMode, cands: T[]):
  { cand: T; mode: SignalMode } | null {
  const rank = (m: SignalMode, rr: number) => (m === 'AGRESIF' ? 0 : m === 'AGRESIF_4' ? 1 : m === 'AGRESIF_3' ? 2 : rr >= 2 ? 3 : 4);
  let best: { cand: T; mode: SignalMode } | null = null;
  for (const c of cands) {
    const e = eligibility(accMode, c.rr, c.score);
    if (!e.ok) continue;
    if (!best) { best = { cand: c, mode: e.mode }; continue; }
    const a = rank(e.mode, c.rr), b = rank(best.mode, best.cand.rr);
    if (a < b || (a === b && (c.score > best.cand.score || (c.score === best.cand.score && c.rr > best.cand.rr)))) {
      best = { cand: c, mode: e.mode };
    }
  }
  return best;
}

export interface OpenInput {
  id: string; ticker: string; setup: string; dir: 'call' | 'put';
  expiry: string; dte: number; strike: number;
  fill: number;            // giriş dolumu (ask + kayma) — çağıran hesaplar
  stopPrem: number;        // başlangıç prim stopu
  targetPrem: number;      // hedef prim
  targetR: number;         // mod hedefi (5 / 4 / 2 / 1,5)
  mode: SignalMode;        // sinyal modu (chooseCandidate / eligibility çıktısı)
  now: number; day: string;
  und?: { entry: number; stop: number; target: number };
}

/** Pozisyon açar. Tek açık pozisyon; DURDU'da ve sermaye yetmiyorsa açmaz. Kesirli kapalı varsayılan. */
export function openPosition(acc: PaperAccount, i: OpenInput): Result {
  if (acc.position) return { ok: false, reason: 'açık pozisyon var' };
  if (acc.mode === 'DURDU') return { ok: false, reason: 'bugünlük durdu' };
  if (!(i.fill > 0) || !Number.isFinite(i.fill)) return { ok: false, reason: 'geçersiz dolum' };
  const a = startDay(acc, i.day);
  const rPrice = i.fill - i.stopPrem;
  if (!(rPrice > 0)) return { ok: false, reason: 'stop giriş fiyatının üstünde' };
  const sz = sizePosition(a.capital, a.kademe, i.fill, { commission: a.settings.commission, fractional: a.settings.fractional });
  if (sz.contracts <= 0) return { ok: false, reason: 'sermaye bu kontrat için yetmiyor' };
  const comm = a.settings.commission;
  const pos: OpenPosition = {
    id: i.id, ticker: i.ticker, setup: i.setup, dir: i.dir, expiry: i.expiry, dte: i.dte, strike: i.strike,
    contracts: sz.contracts, fill: i.fill, costBasis: sz.cost, openComm: sz.openComm,
    stopPrem0: i.stopPrem, stopPrem: i.stopPrem, targetPrem: i.targetPrem,
    rPrice, rDollars: rPrice * 100 * sz.contracts + 2 * comm * sz.contracts,
    targetR: i.targetR, openedAt: i.now, day: a.day, mode: i.mode, kademe: a.kademe,
    overnight: false, maxR: 0, warned: false, und: i.und,
  };
  return { ok: true, acc: { ...a, position: pos } };
}

/** Pozisyonu kapatır (çıkış dolumu = bid − kayma, çağıran hesaplar). Sayaçlar KAPANIŞ gününe yazılır (§7.4). */
export function closePosition(acc: PaperAccount, exit: number, reason: ExitReason, now: number, day: string, gap = false): Result {
  if (!acc.position) return { ok: false, reason: 'açık pozisyon yok' };
  const p = acc.position;
  const a = startDay(acc, day);
  const net = netPnl(p.fill, exit, p.contracts, a.settings.commission);
  const result = classify(net, p.costBasis);
  const kademe = kademeAfter(p.kademe, result);
  const lossStreak = result === 'kazanc' ? 0 : result === 'kayip' ? a.lossStreak + 1 : a.lossStreak;
  const winStreak = result === 'kayip' ? 0 : result === 'kazanc' ? a.winStreak + 1 : a.winStreak;
  // Güvenli moda girişten sonra sayılan kayıplar; işlem güvenli modda kapandıysa sayılır, değilse 0.
  const inSafe = a.mode === 'GUVENLI_ZARAR';
  const safeLossStreak = !inSafe ? 0 : result === 'kayip' ? a.safeLossStreak + 1 : result === 'kazanc' ? 0 : a.safeLossStreak;
  const capital = a.capital + net;
  const dayPnl = a.dayPnl + net;
  const trade: ClosedTrade = {
    id: p.id, ticker: p.ticker, setup: p.setup, day, mode: p.mode, kademe: p.kademe, contracts: p.contracts,
    fill: p.fill, exit, rDollars: p.rDollars, netPnl: net, rMultiple: p.rDollars > 0 ? net / p.rDollars : 0,
    result, reason, capitalBefore: a.capital, capitalAfter: capital, overnight: p.overnight, gap,
  };
  const mode = nextMode(a.mode, { winStreak, lossStreak, safeLossStreak, durduEnabled: a.settings.durduEnabled });
  return {
    ok: true,
    acc: {
      ...a, capital, kademe, winStreak, lossStreak, safeLossStreak, dayPnl, mode, position: null,
      trades: [...a.trades, trade].slice(-TRADE_KEEP),
    },
  };
}

/** Özet istatistik (§7.6): kazanma %, ortalama R, beklenti (R), PF, maks. düşüş ($), en uzun kayıp serisi. */
export function summarize(trades: ClosedTrade[]) {
  const n = trades.length;
  const wins = trades.filter(t => t.result === 'kazanc');
  const losses = trades.filter(t => t.result === 'kayip');
  const grossW = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossL = -losses.reduce((s, t) => s + t.netPnl, 0);
  const avgR = n ? trades.reduce((s, t) => s + t.rMultiple, 0) / n : 0;
  let peak = -Infinity, maxDd = 0, run = 0, longest = 0;
  for (const t of trades) {
    peak = Math.max(peak, t.capitalAfter);
    maxDd = Math.max(maxDd, peak - t.capitalAfter);
    run = t.result === 'kayip' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    n, winPct: n ? (100 * wins.length) / n : 0, avgR, expectancyR: avgR,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0, maxDrawdown: maxDd, longestLossStreak: longest,
  };
}
