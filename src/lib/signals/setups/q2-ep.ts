/* Q2 Episodic Pivot: büyük gap (|gap| ≥ max(%3, gapMult × ATR%)) + ilk 15 dk hacmi ≥ 3 × normal 15 dk; gap yönünde açılış aralığı kırılımı.
 * Qullamaggie uyarlaması — Kaan onayı yok. Katalizör (haber/bilanço) zorunlu değil: backtest'te haber verisi yok, raporda belirtilir. Saf. */
import type { SetupCtx, SetupCandidate, Dir } from '../types.ts';
import { qParams, breakoutCandidate, inQWindow } from './q-common.ts';

/** Bir dakikalık bar sayısı normal 15 dk'da: 390 / 15 = 26 (ortalama günlük hacmin 1/26'sı = 15 dk normali). */
const BARS_PER_15_MIN_NORMAL = 26;

export function q2Ep(c: SetupCtx): SetupCandidate | null {
  const qd = c.qd;
  if (!qd || c.bars.length < 15 || !inQWindow(c.etMin)) return null;
  const gap = c.bars[0].o / qd.lastClose - 1;
  const thr = Math.max(0.03, qParams(c).gapMult * qd.atrPct);
  if (!(Math.abs(gap) >= thr)) return null;
  const vol15 = c.bars.slice(0, 15).reduce((s, b) => s + b.v, 0);
  const normal15 = qd.avgVol20 / BARS_PER_15_MIN_NORMAL;
  if (!(normal15 > 0) || !(vol15 >= 3 * normal15)) return null;
  const dir: Dir = gap > 0 ? 'bull' : 'bear';
  const cat = c.newsImpulse ? 'haber var' : 'katalizör: haber verisi yok (zorunlu değil)';
  return breakoutCandidate(c, 'Q2', dir, [
    `EP: gap ${(gap * 100).toFixed(1)}% (eşik ${(thr * 100).toFixed(1)}%)`,
    `ilk 15 dk hacmi ${(vol15 / normal15).toFixed(1)}× normal`, cat,
  ]);
}
