/* Para yönetimi Monte Carlo ve iflas simülasyonu — SINYAL-FIRSAT §9.3. Saf; tohumlu PRNG (tekrarlanabilir).
 * Her işlem §7 hesap durum makinesinden (account.ts) geçer: kademe, mod, komisyon, başabaş. Gün bloklu bootstrap:
 * ufuk = işlem günü sayısı; her gün, OOS gün kümesinden rastgele bir günün işlem R dizisiyle doldurulur.
 * Kaan kuralı değişmez: sabit kesir karşılaştırması (`fixedKademe`) yalnızca bilgi amaçlıdır. */
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

/** R cinsinden sonuç → çıkış primi. Giriş = fill, stop = fill/3 (1R = fill × 2/3): çıkış = fill × (1 + R × 2/3). −1R = stop. */
export const exitForR = (R: number, fill = 1): number => Math.max(0, fill * (1 + R * (2 / 3)));

export interface McOpts {
  startCapital: number;
  settings?: Partial<PaperSettings>;   // varsayılan: kesirli kontrat (R-tabanlı simülasyon), komisyon 1,50
  paths: number;                       // yol sayısı (ör. 10 000)
  horizons: number[];                  // işlem günü ufukları (ör. [20, 60, 250])
  seed?: number;
  fixedKademe?: Kademe;                // yalnız karşılaştırma: kademe sabitlenir (Kaan kuralı değil, bilgi amaçlı)
  fill?: number;                       // giriş primi ($/hisse); varsayılan 0,80
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

/** Gün dizisi: her gün o günkü işlemlerin R değerleri. Boş gün atlanır. */
export function runMonteCarlo(days: number[][], o: McOpts): HorizonStats[] {
  const usable = days.filter(d => d.length > 0);
  if (!usable.length) throw new Error('MC: işlem içeren gün yok');
  const rnd = mulberry32(o.seed ?? 20261113);
  const start = o.startCapital;
  const fill = o.fill ?? 0.8;
  const settings: Partial<PaperSettings> = { fractional: true, ...(o.settings ?? {}) };
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
        const dayR = usable[Math.floor(rnd() * usable.length)];
        for (const R of dayR) {
          if (acc.mode === 'DURDU') break;
          const r = openPosition(acc, { id: `mc${p}-${trades}`, ticker: 'MC', setup: 'MC', dir: 'call', expiry: key, dte: 0, strike: 1,
            fill, stopPrem: fill / 3, targetPrem: fill * 3, targetR: 3, mode: 'AGRESIF', now: d, day: key });
          if (!r.ok) continue;
          const c = closePosition(r.acc, exitForR(R, fill), 'manuel', d, key);
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
