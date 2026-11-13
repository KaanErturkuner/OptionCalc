/* Kâğıt hesap durum makinesi (saf) — SINYAL-FIRSAT §7.1, §7.4, §7.6.
 * Her fonksiyon girdi durumu DEĞİŞTİRMEZ; yeni durum ya da hata döner. Gerçek emir yok. */
import type { PaperAccount, PaperMode, PaperSettings, OpenPosition, ClosedTrade, ExitReason, TradeResult } from './types.ts';
import { START_KADEME, kademeAfter, sizePosition } from './sizing.ts';
import { DEFAULT_COMMISSION, DEFAULT_SLIPPAGE, netPnl } from './costs.ts';

// ---- sabitler (Kaan kuralları + §7.4 varsayımları) ----
export const WIN_STREAK_KAR = 4;         // gün içi 4 kazanç → GUVENLI_KAR
export const LOSS_STREAK_ZARAR = 2;      // üst üste 2 kayıp → GUVENLI_ZARAR
export const LOSS_STREAK_DURDU = 4;      // güvenli modda 2 kayıp daha (toplam 4) → DURDU (§7.4, açık madde §11.2 #1)
export const DRAWDOWN_DURDU = 0.5;       // gün içi düşüş ≥ gün başı sermayenin %50'si → DURDU
export const BREAKEVEN_PCT = 0.02;       // |net K/Z| < pozisyonun %2'si → başabaş
export const TRADE_KEEP = 500;

/** Mod kuralları (§7.1). Sinyal seçimi: AGRESIF 1:5 → 1:4 (AGRESIF_4); güvenli modlarda 1:2 → 1:1,5. */
export const MODE_RULES: Record<'AGRESIF' | 'AGRESIF_4' | 'GUVENLI_KAR' | 'GUVENLI_ZARAR', { minRR: number; minScore: number }> = {
  AGRESIF: { minRR: 5, minScore: 65 },
  AGRESIF_4: { minRR: 4, minScore: 65 },
  GUVENLI_KAR: { minRR: 1.5, minScore: 70 },
  GUVENLI_ZARAR: { minRR: 1.5, minScore: 75 },
};

export type Result<T = PaperAccount> = { ok: true; acc: T } | { ok: false; reason: string };
/** Sinyal etiketi: DURDU hiçbir sinyale uygulanmaz. */
export type SignalMode = Exclude<PaperMode, 'DURDU'>;

export function initAccount(startCapital: number, over: Partial<PaperSettings> = {}, day = ''): PaperAccount {
  const settings: PaperSettings = {
    // DURDU varsayılan KAPALI (Kaan kararı 2026-11-13, §11.1 K9). Ayar olarak açılabilir.
    startCapital, fractional: false, commission: DEFAULT_COMMISSION, slippage: DEFAULT_SLIPPAGE, durduEnabled: false, ...over,
  };
  return {
    capital: startCapital, kademe: START_KADEME, mode: 'AGRESIF', winStreak: 0, lossStreak: 0,
    day, dayStartCapital: startCapital, dayPnl: 0, position: null, trades: [], settings,
  };
}

/** Net K/Z sınıfı (§7.4): |net| < %2 pozisyon → başabaş. */
export function classify(net: number, costBasis: number): TradeResult {
  if (Math.abs(net) < BREAKEVEN_PCT * costBasis) return 'basabas';
  return net > 0 ? 'kazanc' : 'kayip';
}

/** Gün geçişi (09:30 ET): mod AGRESIF, ardışık sayaçlar ve gün başı sermaye sıfırlanır. Kademe ve açık pozisyon taşınır (§7.4). */
export function startDay(acc: PaperAccount, day: string): PaperAccount {
  if (acc.day === day) return acc;
  return { ...acc, day, mode: 'AGRESIF', winStreak: 0, lossStreak: 0, dayStartCapital: acc.capital, dayPnl: 0 };
}

/** Hesap modu geçişi. Öncelik: DURDU > GUVENLI_ZARAR > GUVENLI_KAR > AGRESIF. Mod gün sonuna kadar yapışkandır. */
export function nextMode(prev: PaperMode, s: {
  winStreak: number; lossStreak: number; dayPnl: number; dayStartCapital: number;
  lossLandedAt30: boolean; durduEnabled: boolean;
}): PaperMode {
  const drawdown = s.dayStartCapital > 0 && -s.dayPnl >= DRAWDOWN_DURDU * s.dayStartCapital;
  if (prev === 'DURDU' || (s.durduEnabled && (s.lossStreak >= LOSS_STREAK_DURDU || drawdown))) return 'DURDU';
  if (prev === 'GUVENLI_ZARAR' || s.lossStreak >= LOSS_STREAK_ZARAR || s.lossLandedAt30) return 'GUVENLI_ZARAR';
  if (prev === 'GUVENLI_KAR' || s.winStreak >= WIN_STREAK_KAR) return 'GUVENLI_KAR';
  return 'AGRESIF';
}

/** Sinyal modu: hesap modu + sinyalin R'si → etiket. Uygun değilse null ("1:4 de yoksa işlem yok"). */
export function signalModeFor(accMode: PaperMode, rr: number): SignalMode | null {
  if (accMode === 'DURDU') return null;
  if (accMode === 'AGRESIF') {
    if (rr >= MODE_RULES.AGRESIF.minRR) return 'AGRESIF';
    if (rr >= MODE_RULES.AGRESIF_4.minRR) return 'AGRESIF_4';
    return null;
  }
  return rr >= MODE_RULES[accMode].minRR ? accMode : null;
}

/** Sinyal uygun mu? (mod + skor + RR). Gerekçe Türkçe. */
export function eligibility(accMode: PaperMode, rr: number, score: number): { ok: true; mode: SignalMode } | { ok: false; reason: string } {
  const mode = signalModeFor(accMode, rr);
  if (accMode === 'DURDU') return { ok: false, reason: 'bugünlük durdu' };
  if (!mode) return { ok: false, reason: 'RR yetersiz (1:5 veya 1:4 yok)' };
  const minScore = MODE_RULES[mode].minScore;
  if (score < minScore) return { ok: false, reason: `skor ${score} < ${minScore}` };
  return { ok: true, mode };
}

/** Aynı taramadaki adaylardan seç: önce 1:5 (AGRESIF), 1:4, güvenli modda önce 1:2; sonra skor, sonra RR. */
export function chooseCandidate<T extends { rr: number; score: number }>(accMode: PaperMode, cands: T[]):
  { cand: T; mode: SignalMode } | null {
  const rank = (m: SignalMode, rr: number) => (m === 'AGRESIF' ? 0 : m === 'AGRESIF_4' ? 1 : rr >= 2 ? 2 : 3);
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
    overnight: false, maxR: 0, warned: false,
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
  const capital = a.capital + net;
  const dayPnl = a.dayPnl + net;
  const trade: ClosedTrade = {
    id: p.id, ticker: p.ticker, setup: p.setup, day, mode: p.mode, kademe: p.kademe, contracts: p.contracts,
    fill: p.fill, exit, rDollars: p.rDollars, netPnl: net, rMultiple: p.rDollars > 0 ? net / p.rDollars : 0,
    result, reason, capitalBefore: a.capital, capitalAfter: capital, overnight: p.overnight, gap,
  };
  const mode = nextMode(a.mode, {
    winStreak, lossStreak, dayPnl, dayStartCapital: a.dayStartCapital,
    lossLandedAt30: result === 'kayip' && kademe === 0.3, durduEnabled: a.settings.durduEnabled,
  });
  return {
    ok: true,
    acc: {
      ...a, capital, kademe, winStreak, lossStreak, dayPnl, mode, position: null,
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
