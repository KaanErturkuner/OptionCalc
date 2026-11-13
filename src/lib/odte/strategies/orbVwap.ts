/*
 * ORB + VWAP teyidi (SPY/QQQ/IWM için tasarlandı).
 * Kural: açılış aralığının (15/30 dk) İLK kapanış bazlı kırılımı (+ tampon), fiyat VWAP'in aynı tarafında ve VWAP o yöne eğimli,
 * kırılım barının hacmi aralık ortalamasının volMult katı. Hedef = kırılım seviyesi ± tgtMult × aralık genişliği; stop = aralık ortası
 * (stopMaxEm ile sınırlı). Her yönde günde en fazla bir giriş.
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type Strategy } from './types.ts';
import { avgVol, clampStop, openRange, vwapAt } from './util.ts';

export interface OrbVwapParams extends CommonParams {
  orMin: number; bufEm: number; volMult: number; slopeBars: number; tgtMult: number; stopMaxEm: number; maxHoldMin: number;
}
export const orbVwap: Strategy<OrbVwapParams> = {
  id: 'orb-vwap', name: 'ORB + VWAP teyidi',
  description: 'Açılış aralığının ilk kırılımı; VWAP yönü ve hacimle teyit. Trend günlerini yakalamayı hedefler.',
  universe: ['SPY', 'QQQ', 'IWM'],
  defaults: { ...COMMON_DEFAULTS, startMin: 15, endMin: 150, orMin: 15, bufEm: 0.03, volMult: 1.2, slopeBars: 10, tgtMult: 1, stopMaxEm: 0.25, maxHoldMin: 120, targetDelta: 0.5 },
  space: { orMin: [15, 30], bufEm: [0, 0.03, 0.06], volMult: [0, 1, 1.5], slopeBars: [5, 10, 20], tgtMult: [0.5, 1, 1.5, 2], stopMaxEm: [0.15, 0.25, 0.35],
    endMin: [90, 150, 240], maxHoldMin: [60, 120, 360], targetDelta: [0.4, 0.5, 0.6] },
  evaluate(c, p) {
    if (!inWindow(c.m, p) || c.m < p.orMin) return null;
    const em = c.day.em0 ?? c.S * 0.008, or = openRange(c.bars, p.orMin); if (!or) return null;
    const n = c.bars.length, last = c.bars[n - 1], buf = p.bufEm * em, w = or.high - or.low;
    const vw = vwapAt(c.bars), vwPrev = vwapAt(c.bars, n - p.slopeBars); if (vw == null || vwPrev == null) return null;
    const orVol = avgVol(c.bars, 0, p.orMin);
    // ilk kapanış bazlı kırılım: OR'dan sonraki barlarda daha önce kırılım olmamalı
    const firstBreak = (up: boolean) => {
      const key = up ? 'upDone' : 'dnDone'; if (c.mem[key]) return false;
      let k = -1;
      for (let i = p.orMin; i < n; i++) if (up ? c.bars[i].c > or.high + buf : c.bars[i].c < or.low - buf) { k = i; break; }
      if (k < 0) return false;
      c.mem[key] = true;                                  // değerlendirildi: sonraki adımlarda tekrar yok
      if (n - 1 - k > 5) return false;                    // kırılım bayat (5 dk'dan eski) → kovalama yok
      return p.volMult <= 0 || c.bars[k].v >= p.volMult * orVol;
    };
    if (last.c > or.high + buf && c.S > vw && vw > vwPrev && firstBreak(true)) {
      return { dir: 'call', undTarget: or.high + p.tgtMult * w, undStop: clampStop(c.S, (or.high + or.low) / 2, 'call', 0.05 * em, p.stopMaxEm * em),
        maxHoldMin: p.maxHoldMin, note: `ORB${p.orMin} yukarı` };
    }
    if (last.c < or.low - buf && c.S < vw && vw < vwPrev && firstBreak(false)) {
      return { dir: 'put', undTarget: or.low - p.tgtMult * w, undStop: clampStop(c.S, (or.high + or.low) / 2, 'put', 0.05 * em, p.stopMaxEm * em),
        maxHoldMin: p.maxHoldMin, note: `ORB${p.orMin} aşağı` };
    }
    return null;
  },
};
