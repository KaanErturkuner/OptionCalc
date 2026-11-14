/* 10. Trend girişi (Kaan'ın tarzı) — onaylı OR kırılımı.
 * Hepsi birden gerekir:
 *   1) Fiyat OR dışına %0,1 tampon ile çıkmış (yukarı: spot ≥ orHigh·1,001; aşağı: spot ≤ orLow·0,999). Gürültülü dokunuşlar elenir.
 *   2) VWAP hold: fiyat VWAP'ın yön tarafında VE son 5 tamamlanmış barın kapanışı da o tarafta.
 *   3) EMA9/EMA21 yön ile hizalı.
 *   4) Spot verisi en çok 3 dk eski (bayat veriyle giriş yok).
 *   5) Giriş penceresi ET 10:00–15:30 (açılış gürültüsü hariç; 15:45 zorunlu çıkıştan önce).
 * Şiddet: 0,55 + min(0,25; mesafe × 15) — kırılım ne kadar belirgin o kadar güçlü. Aday strike: spot ± k × günlük beklenen hareket. */
import type { Signal, Snapshot } from '../types.ts';
import { strikeMult, roundStrike, isEtf } from '../universe.ts';
import { etOffset } from '../../usmarket.ts';
import { sig } from './util.ts';

export const MAX_DATA_AGE_SEC = 180, OR_BUFFER = 0.001, HOLD_BARS = 5, WINDOW_START = 600, WINDOW_END = 930; // dakika (ET)

/** ET saat diliminde gün içi dakika (0–1439) */
export function etMinute(now: number): number {
  const d = new Date(now + etOffset(now) * 3600000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function trend(s: Snapshot): Signal[] {
  if (s.orHigh == null || s.orLow == null || s.vwap == null || s.ema9 == null || s.ema21 == null || s.expectedMove == null || s.expectedMove <= 0) return [];
  if (s.dataAgeSec > MAX_DATA_AGE_SEC) return [];           // bayat spot ile kırılım sinyali üretme
  const m = etMinute(s.now);
  if (m < WINDOW_START || m > WINDOW_END) return [];
  const last = s.bars.slice(-HOLD_BARS);
  if (last.length < HOLD_BARS) return [];
  const up = s.spot >= s.orHigh * (1 + OR_BUFFER) && s.spot > s.vwap && s.ema9 > s.ema21 && last.every(b => b.c > s.vwap!);
  const dn = s.spot <= s.orLow * (1 - OR_BUFFER) && s.spot < s.vwap && s.ema9 < s.ema21 && last.every(b => b.c < s.vwap!);
  if (!up && !dn) return [];
  const dist = up ? s.spot / s.orHigh - 1 : 1 - s.spot / s.orLow;
  const sev = 0.55 + Math.min(0.25, dist * 15);
  const k = strikeMult(s.ticker), raw = s.spot + (up ? 1 : -1) * k * s.expectedMove;
  const strike = roundStrike(raw, s.spot), type = up ? 'C' : 'P';
  return [sig(s, 'trend', up ? 'bull' : 'bear', sev, {
    yon: up ? 'yukarı' : 'aşağı', kontrat: `${strike}${type}`, strike, vade: s.expiry, dte: s.dte, katsayi: k,
    beklenenHareket: +s.expectedMove.toFixed(2), tur: isEtf(s.ticker) ? 'ETF' : 'hisse', kirilim: +(dist * 100).toFixed(2),
  })];
}
