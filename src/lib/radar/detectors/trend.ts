/* 10. Trend adayı (Kaan'ın tarzı). NOT: repoda kaanMomentum.ts yok — geçici kural: 1 dk ORB kırılımı + VWAP tarafı + EMA9/EMA21 hizası.
 *     Aday strike: spot ± k × günlük beklenen hareket (hisse k=1,8; ETF k=0,45). */
import type { Signal, Snapshot } from '../types.ts';
import { strikeMult, roundStrike, isEtf } from '../universe.ts';
import { sig } from './util.ts';

export function trend(s: Snapshot): Signal[] {
  if (s.orHigh == null || s.orLow == null || s.vwap == null || s.ema9 == null || s.ema21 == null || s.expectedMove == null || s.expectedMove <= 0) return [];
  const up = s.spot > s.orHigh && s.spot > s.vwap && s.ema9 > s.ema21;
  const dn = s.spot < s.orLow && s.spot < s.vwap && s.ema9 < s.ema21;
  if (!up && !dn) return [];
  const k = strikeMult(s.ticker), raw = s.spot + (up ? 1 : -1) * k * s.expectedMove;
  const strike = roundStrike(raw, s.spot), type = up ? 'C' : 'P';
  return [sig(s, 'trend', up ? 'bull' : 'bear', 0.6, {
    yon: up ? 'yukarı' : 'aşağı', kontrat: `${strike}${type}`, strike, vade: s.expiry, dte: s.dte, katsayi: k,
    beklenenHareket: +s.expectedMove.toFixed(2), tur: isEtf(s.ticker) ? 'ETF' : 'hisse',
  })];
}
