/*
 * OI duvarı: en yüksek OI'li call (direnç) / put (destek) strike'ı. OI D−1 seansından (yayın açılıştan önce).
 * fade: fiyat duvara nearEm içinde yaklaşıp (gün içi tepe/dip duvara değdi) geri dönüyorsa → duvardan uzağa.
 * break: kapanış duvarı bufEm kadar geçtiyse ve momentum aynı yöndeyse → kırılım yönünde.
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type Strategy } from './types.ts';
import { clampStop, hi, lo } from './util.ts';

export interface OiWallParams extends CommonParams { mode: 'fade' | 'break' | 'both'; nearEm: number; bufEm: number; tgtEm: number; stopEm: number; maxHoldMin: number }
export const oiWall: Strategy<OiWallParams> = {
  id: 'oi-wall', name: 'OI duvarı: geri dönüş / kırılım',
  description: 'En büyük OI strike\'larına (call duvarı / put duvarı) yaklaşınca dönüşü ya da net kırılımı oyna.',
  defaults: { ...COMMON_DEFAULTS, startMin: 30, endMin: 330, mode: 'both', nearEm: 0.1, bufEm: 0.05, tgtEm: 0.3, stopEm: 0.15, maxHoldMin: 120, targetDelta: 0.45 },
  space: { mode: ['fade', 'break', 'both'], nearEm: [0.05, 0.1, 0.2], bufEm: [0.03, 0.05, 0.1], tgtEm: [0.2, 0.3, 0.5], stopEm: [0.1, 0.15, 0.25], endMin: [240, 330, 345], maxHoldMin: [60, 120, 360] },
  evaluate(c, p) {
    if (!inWindow(c.m, p) || c.bars.length < 10) return null;
    const em = c.day.em0 ?? c.S * 0.008, n = c.bars.length, last = c.bars[n - 1], prev = c.bars[n - 2];
    const cw = c.F.w.callWall, pw = c.F.w.putWall, mo = c.F.mo;
    const near = p.nearEm * em, buf = p.bufEm * em, recentHi = hi(c.bars, n - 15), recentLo = lo(c.bars, n - 15);
    const once = (k: string) => { if (c.mem[k]) return false; c.mem[k] = true; return true; };
    if (cw != null) {
      if (p.mode !== 'break' && c.S < cw && cw - recentHi <= near && last.c < last.o && last.c < prev.c && once('cwFade'))
        return { dir: 'put', undTarget: c.S - p.tgtEm * em, undStop: clampStop(c.S, cw + buf, 'put', 0.05 * em, p.stopEm * em), maxHoldMin: p.maxHoldMin, note: `Call duvarı ${cw} red` };
      if (p.mode !== 'fade' && last.c > cw + buf && prev.c <= cw + buf && mo && mo.r5 > 0 && once('cwBreak'))
        return { dir: 'call', undTarget: c.S + p.tgtEm * em, undStop: clampStop(c.S, cw - buf, 'call', 0.05 * em, p.stopEm * em), maxHoldMin: p.maxHoldMin, note: `Call duvarı ${cw} kırıldı` };
    }
    if (pw != null) {
      if (p.mode !== 'break' && c.S > pw && recentLo - pw <= near && last.c > last.o && last.c > prev.c && once('pwFade'))
        return { dir: 'call', undTarget: c.S + p.tgtEm * em, undStop: clampStop(c.S, pw - buf, 'call', 0.05 * em, p.stopEm * em), maxHoldMin: p.maxHoldMin, note: `Put duvarı ${pw} destek` };
      if (p.mode !== 'fade' && last.c < pw - buf && prev.c >= pw - buf && mo && mo.r5 < 0 && once('pwBreak'))
        return { dir: 'put', undTarget: c.S - p.tgtEm * em, undStop: clampStop(c.S, pw + buf, 'put', 0.05 * em, p.stopEm * em), maxHoldMin: p.maxHoldMin, note: `Put duvarı ${pw} kırıldı` };
    }
    return null;
  },
};
