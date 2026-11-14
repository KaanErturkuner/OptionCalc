/*
 * Fırsat setupları (SINYAL-FIRSAT §6.2) → backtest Strategy sarmalayıcısı (§9.2). Her setup ayrı bir strateji: firsat-s1 … firsat-s6.
 * Motor yalnızca tamamlanmış 1 dk barları, günlük EM'i (day.em0) ve peer barlarını verir; setup mantığı signals/setups'ta, aynen.
 * Yaklaşımlar (bilinçli, rapora yazılır):
 *  - A1 rejimi: yalnız kendi sembolünün VWAP tarafı (QQQ dışı rejim sembolleri bu sarmalayıcıda yok).
 *  - Kalan EM: günlük EM × √(kalan dakika / 390) (canlı straddle yok).
 *  - Duvarlar (S4) ve haber (S5) bu sarmalayıcıda yok → S4 ve S5 hiç üretmez.
 *  - Strike: varsayılan `oto` (B9, Kaan D8): S ± k × EM0, k = profilin OTM kuralı (QQQ sabit çapa 0,45; NVDA/GLD/SLV oto).
 *    `delta` (targetDelta ile kontrat seçimi) yalnız karşılaştırma içindir (otmMode parametresi).
 *  - Çıkış: prim stopu −%40 ve risk bazlı prim hedefi motorda (RunOpts.kaan). maxHoldMin yok (Kaan kuralı yok).
 *  - Gece taşıma backtest'te yok: pozisyon 15:45 ET'de kapanır (uygulamada takvim kapısına bağlı, §7.8).
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type Strategy, type StratCtx, type StratEntry } from './types.ts';
import { vwapAt, openRange } from './util.ts';
import { runSetups } from '../../signals/setups/index.ts';
import type { SetupId, SetupCtx } from '../../signals/types.ts';
import { autoK, otmDistance } from '../../signals/otm.ts';
import { profileFor } from '../../signals/profiles.ts';

export interface FirsatParams extends CommonParams { otmMode: 'oto' | 'delta' }

const SESSION_MIN = 390;          // 09:30–16:00 ET
const SESSION_OPEN_MIN = 570;     // 09:30 ET, dakika (gece yarısından)

/** Motorun StratCtx'inden setup bağlamı kurar. Veri yoksa null. */
export function setupCtxOf(c: StratCtx, id: SetupId): SetupCtx | null {
  const em = c.day.em0;
  if (em == null || !(em > 0)) return null;
  const bars = c.bars, n = bars.length;
  if (n < 2) return null;
  const or = openRange(bars, 15), vw = vwapAt(bars);
  if (!or || vw == null) return null;
  const last = bars[n - 1];
  const lookback = bars.slice(Math.max(0, n - 21), n - 1);
  const avgV = lookback.length ? lookback.reduce((s, b) => s + b.v, 0) / lookback.length : 0;
  const ratio = avgV > 0 ? last.v / avgV : NaN;
  const left = Math.max(0, SESSION_MIN - c.m);
  const emRemain = em * Math.sqrt(left / SESSION_MIN);
  const bull = c.S > vw, bear = c.S < vw;
  return {
    ticker: c.ticker, now: c.t, etMin: SESSION_OPEN_MIN + c.m, dte: c.day.dte, bars, S: c.S, em, emRemain,
    vwap: vw, orHi: or.high, orLo: or.low, volRatio: ratio,
    align: { bull, bear }, allowed: [id], newsImpulse: null, walls: null, ivRank: null, rv10: null, atmIv: null,
  };
}

const mk = (id: SetupId, name: string, desc: string): Strategy<FirsatParams> => ({
  id: `firsat-${id.toLowerCase()}`, name, description: desc,
  universe: ['QQQ', 'GLD', 'SLV', 'NVDA'],
  defaults: { ...COMMON_DEFAULTS, startMin: 15, endMin: 240, targetDelta: 0.5, maxPerDay: 2, otmMode: 'oto' },
  space: { endMin: [120, 180, 240], targetDelta: [0.4, 0.5, 0.6] },
  evaluate(c: StratCtx, p: FirsatParams): StratEntry | null {
    if (!inWindow(c.m, p)) return null;
    const sc = setupCtxOf(c, id);
    if (!sc) return null;
    const cand = runSetups(sc)[0];
    if (!cand) return null;
    const sg = cand.dir === 'bull' ? 1 : -1;
    const base: StratEntry = {
      dir: cand.dir === 'bull' ? 'call' : 'put',
      undTarget: cand.und.target, undStop: cand.und.stop,
      targetDelta: p.targetDelta,
      note: `${cand.setup}: ${cand.reason.join(' · ')}`,
    };
    if (p.otmMode === 'delta') return base;
    // Oto/sabit k: uzaklık d = k × EM0 (QQQ sabit çapa, diğerleri oynaklık). EM0 yoksa giriş yok.
    const em = c.day.em0;
    if (em == null || !(em > 0)) return null;
    const k = autoK({ rule: profileFor(c.ticker).otm, ratios: c.day.ratios ?? [], ivRank: null });
    return { ...base, strike: c.S + sg * otmDistance(k.k, em), note: `${base.note} · k=${k.k.toFixed(2)} (${k.source})` };
  },
});

export const firsatStrategies: Strategy<FirsatParams>[] = [
  mk('S1', 'Fırsat S1: uyumlu açılış aralığı kırılımı', 'OR kırılımı + VWAP tarafı + hacim (SINYAL-FIRSAT S1)'),
  mk('S2', 'Fırsat S2: sıkışma sonrası kırılım', 'Dar kutu + kırılım + hacim (S2)'),
  mk('S3', 'Fırsat S3: trend içi VWAP geri alma', 'VWAP/EMA geri çekilmesi ve dönüş (S3)'),
  mk('S4', 'Fırsat S4: gamma/OI duvarı kırılımı', 'Duvar verisi bu sarmalayıcıda yok → üretmez (S4)'),
  mk('S5', 'Fırsat S5: haber sonrası devam', 'Haber verisi bu sarmalayıcıda yok → üretmez (S5)'),
  mk('S6', 'Fırsat S6: ucuz IV + hareket öncesi', 'IV rank verisi bu sarmalayıcıda yok → üretmez (S6)'),
];
