/* Para yönetimi Monte Carlo ve iflas simülasyonu — SINYAL-FIRSAT §9.3. Saf; tohumlu PRNG (tekrarlanabilir).
 * Her işlem §7 hesap durum makinesinden (account.ts) geçer: kademe, mod, komisyon, başabaş. Gün bloklu bootstrap:
 * ufuk = işlem günü sayısı; her gün, OOS gün kümesinden rastgele bir günün işlem dizisiyle doldurulur.
 *
 * Varsayılanlar (Başkan incelemesi, 2026-11-13): DURDU AÇIK; hedef tanımı K8 (1:N = çıkış/giriş = N, yani 1:5 → 750 $).
 * Karşılaştırma: eski R tabanlı 1:5 (+5R, çıkış 650 $) ve DURDU kapalı — bilgi amaçlıdır; ürün varsayılanını değiştirmez.
 * Kaan kuralı (%50, kademe 30/40/50) değişmez. */
import { initAccount, openPosition, closePosition, startDay } from './account.ts';
import type { PaperAccount, PaperSettings, Kademe } from './types.ts';

/** Mulberry32: tohumlu, tekrarlanabilir PRNG (0..1). */
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

/** Hedef tanımı: K8 = çıkış/giriş = N (1:5 → 5 kat prim → R = 1,5 × (N−1) = 6R). R650 = eski tanım, hedef +5R (N'den bağımsız, 1:5 → 5R). */
export type TargetConvention = 'K8' | 'R650';
export function targetR(conv: TargetConvention, N = 5): number {
  return conv === 'K8' ? 1.5 * (N - 1) : N;
}

/** Bir işlemin sonucu: hedefe ulaştı, stop, ya da (zaman/gün sonu vb.) doğrudan R değeri. */
export type McOutcome = { kind: 'hedef' } | { kind: 'stop' } | { kind: 'diger'; R: number };

/** Sonuç → R. Hedef: seçilen tanımın R'si. Stop: −1R. Diğer: verilen R. */
export function outcomeR(o: McOutcome, conv: TargetConvention, N = 5): number {
  if (o.kind === 'hedef') return targetR(conv, N);
  if (o.kind === 'stop') return -1;
  return o.R;
}

/** R cinsinden sonuç → çıkış primi. Giriş = fill, stop = fill/3 → 1R = fill × 2/3: çıkış = fill × (1 + R × 2/3). −1R = stop. */
export const exitForR = (R: number, fill = 1): number => Math.max(0, fill * (1 + R * (2 / 3)));

export interface McOpts {
  startCapital: number;
  settings?: Partial<PaperSettings>;   // varsayılan: kesirli kontrat, komisyon 1,50, DURDU AÇIK
  paths: number;                       // yol sayısı (ör. 10 000)
  horizons: number[];                  // işlem günü ufukları (ör. [20, 60, 250])
  seed?: number;
  fixedKademe?: Kademe;                // yalnız karşılaştırma: kademe sabitlenir (Kaan kuralı değil, bilgi amaçlı)
  fill?: number;                       // giriş primi ($/hisse); varsayılan 0,80
  targetConvention?: TargetConvention; // varsayılan K8
  targetN?: number;                    // hedef çarpanı N (1:N); varsayılan 5
}

export interface HorizonStats {
  horizon: number;
  medianCapital: number; p10Capital: number; p90Capital: number;
  probBelowStart: number;              // bitiş sermayesi < başlangıç
  ruinProb: number;                    // sermaye < başlangıcın %10'u veya en küçük kademeyle 1 kontrat alınamıyor
  meanMaxDrawdown: number;             // $ (yol başına ortalama)
  longestLossStreak: number;           // tüm yollarda en uzun kayıp serisi (işlem)
  meanTrades: number;                  // yol başına ortalama işlem
}

/** Gün dizisi: her gün o günkü işlem sonuçları. Boş gün atlanır. */
export function runMonteCarlo(days: McOutcome[][], o: McOpts): HorizonStats[] {
  const usable = days.filter(d => d.length > 0);
  if (!usable.length) throw new Error('MC: işlem içeren gün yok');
  const rnd = mulberry32(o.seed ?? 20261113);
  const start = o.startCapital;
  const fill = o.fill ?? 0.8;
  const conv = o.targetConvention ?? 'K8', N = o.targetN ?? 5;
  // DURDU varsayılan AÇIK (Başkan incelemesi); ayar ile kapatılabilir.
  const settings: Partial<PaperSettings> = { fractional: true, durduEnabled: true, ...(o.settings ?? {}) };
  const comm = settings.commission ?? 1.5;
  const oneContractCost = fill * 100 + comm;
  const out: HorizonStats[] = [];

  for (const H of o.horizons) {
    const finals: number[] = [], dds: number[] = [];
    let ruin = 0, below = 0, longest = 0, trades = 0;
    for (let p = 0; p < o.paths; p++) {
      let acc: PaperAccount = initAccount(start, settings, 'd0');
      let peak = start, maxDd = 0, run = 0, ruined = false;
      for (let d = 0; d < H && !ruined; d++) {
        const key = `d${d + 1}`;
        acc = startDay(acc, key);
        if (o.fixedKademe) acc = { ...acc, kademe: o.fixedKademe };
        const day = usable[Math.floor(rnd() * usable.length)];
        for (const oc of day) {
          if (acc.mode === 'DURDU') break;
          const r = openPosition(acc, { id: `mc${p}-${trades}`, ticker: 'MC', setup: 'MC', dir: 'call', expiry: key, dte: 0, strike: 1,
            fill, stopPrem: fill / 3, targetPrem: fill * 3, targetR: 3, mode: 'AGRESIF', now: d, day: key });
          if (!r.ok) continue;
          const c = closePosition(r.acc, exitForR(outcomeR(oc, conv, N), fill), 'manuel', d, key);
          if (!c.ok) continue;
          acc = c.acc;
          trades++;
          run = acc.trades[acc.trades.length - 1].result === 'kayip' ? run + 1 : 0;
          longest = Math.max(longest, run);
          peak = Math.max(peak, acc.capital);
          maxDd = Math.max(maxDd, peak - acc.capital);
          const affordable = acc.capital * 0.3 >= oneContractCost;
          if (acc.capital < 0.1 * start || !affordable) { ruined = true; break; }
        }
      }
      finals.push(acc.capital);
      dds.push(maxDd);
      if (ruined) ruin++;
      if (acc.capital < start) below++;
    }
    finals.sort((a, b) => a - b);
    const q = (x: number) => finals[Math.min(finals.length - 1, Math.max(0, Math.floor(x * (finals.length - 1))))];
    out.push({
      horizon: H, medianCapital: q(0.5), p10Capital: q(0.1), p90Capital: q(0.9),
      probBelowStart: below / o.paths, ruinProb: ruin / o.paths,
      meanMaxDrawdown: dds.reduce((a, b) => a + b, 0) / o.paths, longestLossStreak: longest,
      meanTrades: trades / o.paths,
    });
  }
  return out;
}

export interface McVariant { name: string; targetConvention: TargetConvention; durduEnabled: boolean; stats: HorizonStats[] }

/**
 * Başkan'ın istediği iki karşılaştırma: birincil (K8 + DURDU açık) ve yan varyantlar (650 = R650; DURDU kapalı).
 * Tüm varyantlar aynı tohum ve aynı gün dizisiyle koşar (kıyas adil).
 */
export function runMcVariants(days: McOutcome[][], base: Omit<McOpts, 'targetConvention' | 'settings'>): McVariant[] {
  const defs: { name: string; targetConvention: TargetConvention; durduEnabled: boolean }[] = [
    { name: 'birincil: K8 (1:5 = 750 $), DURDU açık', targetConvention: 'K8', durduEnabled: true },
    { name: 'karşılaştırma: R650 (1:5 = 650 $), DURDU açık', targetConvention: 'R650', durduEnabled: true },
    { name: 'karşılaştırma: K8, DURDU kapalı', targetConvention: 'K8', durduEnabled: false },
    { name: 'karşılaştırma: R650, DURDU kapalı', targetConvention: 'R650', durduEnabled: false },
  ];
  return defs.map(d => ({
    name: d.name, targetConvention: d.targetConvention, durduEnabled: d.durduEnabled,
    stats: runMonteCarlo(days, { ...base, targetConvention: d.targetConvention, settings: { durduEnabled: d.durduEnabled } }),
  }));
}
