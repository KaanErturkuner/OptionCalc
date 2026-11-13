/*
 * Beklenen hareket aşımı sonrası momentum: fiyat referanstan (önceki kapanış ya da açılış) k × günlük beklenen hareketi
 * aştığında, aşım yönünde devam et (piyasanın fiyatladığından büyük gün = trend günü). VWAP aynı tarafta olmalı.
 * Stop = aşım seviyesinin biraz içi; hedef = ek tgtEm × em.
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type Strategy } from './types.ts';
import { clampStop } from './util.ts';

export interface EmBreachParams extends CommonParams { ref: 'prevClose' | 'open'; k: number; backEm: number; tgtEm: number; stopMaxEm: number; maxHoldMin: number; needVwap: boolean }
export const emBreach: Strategy<EmBreachParams> = {
  id: 'em-breach', name: 'Beklenen hareket aşımı → momentum',
  description: 'Fiyat günün beklenen hareketinin k katını aşınca aşım yönünde devam eden hareketi oyna.',
  defaults: { ...COMMON_DEFAULTS, startMin: 30, endMin: 300, ref: 'prevClose', k: 0.8, backEm: 0.1, tgtEm: 0.3, stopMaxEm: 0.25, maxHoldMin: 120, needVwap: true, targetDelta: 0.5 },
  space: { ref: ['prevClose', 'open'], k: [0.5, 0.7, 0.8, 1, 1.2], backEm: [0.05, 0.1, 0.2], tgtEm: [0.2, 0.3, 0.5], stopMaxEm: [0.15, 0.25], startMin: [30, 60, 90], endMin: [240, 300, 345], maxHoldMin: [60, 120, 360] },
  evaluate(c, p) {
    if (!inWindow(c.m, p)) return null;
    const em = c.day.em0; if (em == null) return null;
    const ref = p.ref === 'open' ? c.day.openPx : c.day.prevClose; if (ref == null) return null;
    const lvlUp = ref + p.k * em, lvlDn = ref - p.k * em, vw = c.F.vw;
    const once = (k: string) => { if (c.mem[k]) return false; c.mem[k] = true; return true; };
    if (c.S > lvlUp && (!p.needVwap || (vw != null && c.S > vw)) && once('up'))
      return { dir: 'call', undTarget: c.S + p.tgtEm * em, undStop: clampStop(c.S, lvlUp - p.backEm * em, 'call', 0.05 * em, p.stopMaxEm * em), maxHoldMin: p.maxHoldMin,
        note: `EM aşımı yukarı (${((c.S - ref) / em).toFixed(2)} em)` };
    if (c.S < lvlDn && (!p.needVwap || (vw != null && c.S < vw)) && once('dn'))
      return { dir: 'put', undTarget: c.S - p.tgtEm * em, undStop: clampStop(c.S, lvlDn + p.backEm * em, 'put', 0.05 * em, p.stopMaxEm * em), maxHoldMin: p.maxHoldMin,
        note: `EM aşımı aşağı (${((ref - c.S) / em).toFixed(2)} em)` };
    return null;
  },
};
