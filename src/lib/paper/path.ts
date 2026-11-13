/* Gerçek OOS işlem dizisini kâğıt hesap durum makinesinden (account.ts) geçirme ve yol Monte Carlo'su — SINYAL-FIRSAT §9.3, Kaan D12.
 * Saf; ağ ve Node'a özgü bağımlılık yok. Motor (backtest/engine.mts) her işlem için şunları verir:
 *   R (gerçekleşen, 1:5 birincil politika altında; net = R × risk − 2 × komisyon), hit[L] (prim yolunda L R'ye İLK geçiş,
 *   yalnız stop'tan önce), stopped (stop ile kapandı mı).
 * Hesap modu hedefi (Kaan D12): AGRESIF → 1:N (birincil 5); GUVENLI_KAR / GUVENLI_ZARAR → 1:2 (1:1,5 modellenmedi).
 * Hedef R'ye ulaşılmadıysa işlem gerçekleşen R ile kapanır. Hedef, hit[T] ile belirlenir: stop'tan önce T'ye ulaşıldıysa +T.
 * Varsayım: giriş, sinyal modu ayrımından bağımsız olarak motorun girişi ile aynıdır (skor kapısı backtest'te uygulanmadı).
 * Risk tanımı motorla aynı: prim stopu = giriş × 0,33 → 1R = giriş × 0,67 (kontrat başına).
 */
import { initAccount, openPosition, closePosition, startDay, summarize } from './account.ts';
import type { ClosedTrade, PaperAccount, PaperMode, PaperSettings } from './types.ts';

/** Engine ile aynı seviyeler (backtest/engine.mts HIT_LEVELS). */
export const PATH_HIT_LEVELS = [1.5, 2, 4, 5] as const;
export const PRIM_RISK_SHARE = 0.67;     // 1R = giriş × 0,67 (prim stopu %67)

/** Bir işlemin yol bilgisi (engine ETrade'inden türetilir). */
export interface PathTrade {
  id: string; ticker: string; dir: 'call' | 'put'; dte: number;
  D: string;                  // giriş günü (ET)
  entryT: number; exitT: number;  // ms
  fill: number;               // giriş dolumu (ask + kayma) — kontrat başına $
  R: number;                  // gerçekleşen R (birincil politika)
  hit: Partial<Record<number, boolean>>;  // hedef seviyesine İLK geçiş (stop'tan önce)
  stopped: boolean;
}

/** Hedef politikası: AGRESIF'te N (birincil 5; yedek 4), güvenli modlarda 2. */
export interface TargetPolicy { agresif: number; safe: number }
export const DEFAULT_POLICY: TargetPolicy = { agresif: 5, safe: 2 };

/** Hesap modu → hedef R. DURDU'da işlem yok (çağıran kontrol eder). */
export function targetFor(mode: PaperMode, pol: TargetPolicy = DEFAULT_POLICY): number {
  return mode === 'GUVENLI_KAR' || mode === 'GUVENLI_ZARAR' ? pol.safe : pol.agresif;
}

/** Hedef T için işlemin R'si: T'ye ulaşıldıysa T, yoksa gerçekleşen R. T, motorun seviyelerinden biri olmalı. */
export function rUnder(t: PathTrade, T: number): number {
  if (!(PATH_HIT_LEVELS as readonly number[]).includes(T)) throw new Error(`hedef seviyesi motorda yok: ${T}R`);
  return t.hit[T] ? T : t.R;
}

/** Çıkış dolumu (kontrat başına $) → R: exit = fill × (1 + 0,67 × R). −1R = fill × 0,33. */
export const exitForRPath = (R: number, fill: number): number => Math.max(0, fill * (1 + PRIM_RISK_SHARE * R));

export interface Counters {
  busy: number; durdu: number; noCapital: number; taken: number;
  capital: number; peak: number; maxDd: number; run: number; longest: number;
  floor: number; ruined: boolean; trades: ClosedTrade[];
}
export function newCounters(start: number): Counters {
  return { busy: 0, durdu: 0, noCapital: 0, taken: 0, capital: start, peak: start, maxDd: 0, run: 0, longest: 0, floor: 0.1 * start, ruined: false, trades: [] };
}

/** Bir gün anahtarı altında işlemleri sırayla uygular. Tek açık pozisyon (önceki işlem bitmeden açılmaz); DURDU'da durur. */
export function runTrades(acc0: PaperAccount, trades: PathTrade[], pol: TargetPolicy, key: string, c: Counters): PaperAccount {
  let acc = startDay(acc0, key), lastExit = -Infinity;
  for (const t of [...trades].sort((a, b) => a.entryT - b.entryT)) {
    if (c.ruined) break;
    if (t.entryT < lastExit) { c.busy++; continue; }
    if (acc.mode === 'DURDU') { c.durdu++; continue; }
    const T = targetFor(acc.mode, pol), R = rUnder(t, T);
    const mode = acc.mode as Exclude<PaperMode, 'DURDU'>;
    const op = openPosition(acc, {
      id: t.id, ticker: t.ticker, setup: 'FIRSAT', dir: t.dir, expiry: t.D, dte: t.dte, strike: 0,
      fill: t.fill, stopPrem: t.fill * (1 - PRIM_RISK_SHARE), targetPrem: exitForRPath(T, t.fill), targetR: T,
      mode, now: t.entryT, day: key,
    });
    if (!op.ok) { c.noCapital++; continue; }
    const reason = t.hit[T] ? 'hedef' : t.stopped ? 'stop' : 'zaman';
    const cl = closePosition(op.acc, exitForRPath(R, t.fill), reason, t.exitT, key);
    if (!cl.ok) { c.noCapital++; continue; }
    // Yol simülasyonu yalnız son işlemi okur (sayaçlar c.trades'te); dizi kırpılır ki her kapanışta 500 elemanlık kopya oluşmasın.
    acc = { ...cl.acc, trades: [cl.acc.trades[cl.acc.trades.length - 1]] };
    const last = acc.trades[acc.trades.length - 1];
    c.trades.push(last); c.taken++;
    c.capital = acc.capital; c.peak = Math.max(c.peak, acc.capital); c.maxDd = Math.max(c.maxDd, c.peak - acc.capital);
    c.run = last.result === 'kayip' ? c.run + 1 : 0; c.longest = Math.max(c.longest, c.run);
    lastExit = t.exitT + 60000;
    if (acc.capital < c.floor) c.ruined = true;
  }
  return acc;
}

export interface ReplayOpts { startCapital: number; policy?: TargetPolicy; settings?: Partial<PaperSettings> }
export interface ReplayResult extends Counters { final: number; summary: ReturnType<typeof summarize>; days: number }

/** Kronolojik OOS işlem dizisini tek hesapta oynat (her işlem günü ayrı gün anahtarı). */
export function replayTrades(trades: PathTrade[], o: ReplayOpts): ReplayResult {
  const pol = o.policy ?? DEFAULT_POLICY, c = newCounters(o.startCapital);
  const byDay = new Map<string, PathTrade[]>();
  for (const t of trades) { const a = byDay.get(t.D); if (a) a.push(t); else byDay.set(t.D, [t]); }
  let acc = initAccount(o.startCapital, o.settings ?? {}, '');
  const days = [...byDay.keys()].sort();
  for (const d of days) acc = runTrades(acc, byDay.get(d)!, pol, d, c);
  return { ...c, final: acc.capital, summary: summarize(c.trades), days: days.length };
}

export interface PathStats {
  horizon: number; paths: number;
  median: number; p5: number; p95: number;
  probBelowStart: number;   // bitiş sermayesi < başlangıç
  ruinProb: number;         // yol boyunca HERHANGİ bir anda sermaye < %10 (iflas)
  meanMaxDd: number;        // $ ortalama maks. düşüş
  meanTrades: number; meanNoCapital: number;
  longestLoss: number;      // tüm yollarda en uzun kayıp serisi
  stuckProb: number;        // bitişte sermaye `stuckBelow`'un altında (ör. %50 kademeyle tipik 1 kontrat alınamıyor); verilmezse NaN
}

/** Gün bloklu bootstrap: her simülasyon günü, OOS gün listesinden (işlemsiz günler dâhil) tekdüze çekilen bir günün işlemleriyle oynanır. */
export function runPathMc(dayTrades: PathTrade[][], o: { startCapital: number; horizons: number[]; paths: number; seed?: number; policy?: TargetPolicy; settings?: Partial<PaperSettings>; stuckBelow?: number }): PathStats[] {
  if (!dayTrades.length) throw new Error('MC: gün listesi boş');
  const pol = o.policy ?? DEFAULT_POLICY, rnd = mulberry32(o.seed ?? 20261113), start = o.startCapital;
  const out: PathStats[] = [];
  for (const H of o.horizons) {
    const finals: number[] = [], dds: number[] = [];
    let ruin = 0, below = 0, trades = 0, noCap = 0, longest = 0, stuck = 0;
    for (let p = 0; p < o.paths; p++) {
      let acc = initAccount(start, o.settings ?? {}, '');
      const c = newCounters(start);
      for (let d = 0; d < H && !c.ruined; d++) {
        const day = dayTrades[Math.floor(rnd() * dayTrades.length)];
        acc = runTrades(acc, day, pol, `d${d + 1}`, c);
      }
      finals.push(acc.capital); dds.push(c.maxDd); trades += c.taken; noCap += c.noCapital;
      longest = Math.max(longest, c.longest);
      if (c.ruined) ruin++;
      if (acc.capital < start) below++;
      if (o.stuckBelow != null && acc.capital < o.stuckBelow) stuck++;
    }
    finals.sort((a, b) => a - b);
    const q = (x: number) => finals[Math.min(finals.length - 1, Math.max(0, Math.floor(x * (finals.length - 1))))];
    out.push({
      horizon: H, paths: o.paths, median: q(0.5), p5: q(0.05), p95: q(0.95),
      probBelowStart: below / o.paths, ruinProb: ruin / o.paths,
      meanMaxDd: dds.reduce((a, b) => a + b, 0) / o.paths, meanTrades: trades / o.paths, meanNoCapital: noCap / o.paths, longestLoss: longest,
      stuckProb: o.stuckBelow != null ? stuck / o.paths : NaN,
    });
  }
  return out;
}

/** Tohumlu PRNG (Mulberry32), tekrarlanabilir. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** R dizisi özeti: n, kazanma % (R > 0), ortalama R, profit factor (R). */
export function rSummary(rs: number[]) {
  const n = rs.length;
  const gw = rs.filter(x => x > 0).reduce((a, b) => a + b, 0), gl = -rs.filter(x => x < 0).reduce((a, b) => a + b, 0);
  return { n, win: n ? rs.filter(x => x > 0).length / n : NaN, avg: n ? rs.reduce((a, b) => a + b, 0) / n : NaN, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : NaN };
}

/** Ortalama R için bootstrap %95 güven aralığının alt sınırı (B yeniden örnekleme, tohumlu). */
export function bootstrapMeanCiLo(xs: number[], B = 1000, seed = 7): number {
  const n = xs.length;
  if (n < 5) return NaN;
  const rnd = mulberry32(seed), means: number[] = [];
  for (let b = 0; b < B; b++) { let a = 0; for (let i = 0; i < n; i++) a += xs[Math.floor(rnd() * n)]; means.push(a / n); }
  means.sort((a, b) => a - b);
  return means[Math.floor(0.025 * B)];
}
