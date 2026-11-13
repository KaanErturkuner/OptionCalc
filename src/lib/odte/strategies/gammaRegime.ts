/*
 * Gamma rejimi: pozitif net GEX ve fiyat flip'in üstünde → bayiler hareketi söndürür → VWAP'a ORTALAMAYA DÖNÜŞ (sapmayı söndür).
 * Negatif net GEX ya da flip altı → bayiler hareketi büyütür → VWAP'tan uzaklaşan hareketi TREND olarak takip et.
 * mode: 'auto' (rejime göre), 'mr' (yalnızca dönüş), 'trend' (yalnızca trend). OI D−1'den (ileriye bakış yok).
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type Strategy } from './types.ts';
import { clampStop, ret } from './util.ts';

export interface GammaRegimeParams extends CommonParams {
  mode: 'auto' | 'mr' | 'trend';
  devEm: number;       // |S − VWAP| eşiği (em0 katı)
  mrTgt: number;       // dönüşte sapmanın ne kadarını hedefle (0..1)
  trendTgtEm: number;  // trendde hedef (em0 katı)
  stopEm: number;      // stop mesafesi (em0 katı)
  stallBars: number;   // dönüş için: son n barda sapma yönünde ilerleme durmuş olmalı
  maxHoldMin: number;
}
export const gammaRegime: Strategy<GammaRegimeParams> = {
  id: 'gamma-regime', name: 'Gamma flip rejimi (dönüş / trend)',
  description: 'Net GEX ve gamma flip ile rejim belirle: pozitif gamma → VWAP\'a dönüş, negatif gamma → trend takibi.',
  universe: ['SPY', 'QQQ', 'IWM'],
  defaults: { ...COMMON_DEFAULTS, startMin: 30, endMin: 300, mode: 'auto', devEm: 0.35, mrTgt: 0.7, trendTgtEm: 0.35, stopEm: 0.2, stallBars: 5, maxHoldMin: 90, targetDelta: 0.5 },
  space: { mode: ['auto', 'mr', 'trend'], devEm: [0.2, 0.35, 0.5, 0.7], mrTgt: [0.5, 0.7, 1], trendTgtEm: [0.25, 0.35, 0.5], stopEm: [0.1, 0.2, 0.3],
    stallBars: [3, 5, 10], startMin: [30, 60], endMin: [180, 300, 345], maxHoldMin: [45, 90, 180] },
  evaluate(c, p) {
    if (!inWindow(c.m, p)) return null;
    const em = c.day.em0 ?? c.S * 0.008, vw = c.F.vw; if (vw == null) return null;
    const dev = c.S - vw; if (Math.abs(dev) < p.devEm * em) return null;
    const flip = c.F.gx.flip, pos = c.F.gx.net > 0 && (flip == null || c.S > flip);
    const regime = p.mode === 'auto' ? (pos ? 'mr' : 'trend') : p.mode;
    const up = dev > 0;
    if (regime === 'mr') {
      // sapma yönünde ilerleme durmuş: son stallBars getirisi sapmaya karşı ya da ~0
      const r = ret(c.bars, p.stallBars); if (up ? r > 0 : r < 0) return null;
      const dir = up ? 'put' as const : 'call' as const, tgt = c.S - p.mrTgt * dev;
      return { dir, undTarget: tgt, undStop: clampStop(c.S, c.S + (up ? 1 : -1) * p.stopEm * em, dir, 0.05 * em, p.stopEm * em), maxHoldMin: p.maxHoldMin,
        note: `MR (${pos ? '+γ' : 'zorla'}) sapma ${(dev / em).toFixed(2)} em` };
    }
    const mo = c.F.mo; if (!mo) return null;
    const aligned = up ? mo.ema9 > mo.ema21 && mo.r5 > 0 : mo.ema9 < mo.ema21 && mo.r5 < 0; if (!aligned) return null;
    const dir = up ? 'call' as const : 'put' as const;
    return { dir, undTarget: c.S + (up ? 1 : -1) * p.trendTgtEm * em, undStop: clampStop(c.S, vw, dir, 0.05 * em, p.stopEm * em), maxHoldMin: p.maxHoldMin,
      note: `Trend (${pos ? 'zorla' : '−γ'}) sapma ${(dev / em).toFixed(2)} em` };
  },
};
