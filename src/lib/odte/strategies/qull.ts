/*
 * Qullamaggie setupları (Q1, Q1S, Q2, Q3) → backtest Strategy sarmalayıcısı. Qullamaggie uyarlaması — Kaan onayı yok.
 * Yaklaşımlar (bilinçli, rapora yazılır):
 *  - Motor 5 dk ızgarasında (STEP) değerlendirir: kırılım, ızgara noktasında ilk görülen kırılımdır; gerçek bar bazlı tetikten sapabilir.
 *  - Günlük barlar DayInfo.daily / spyDaily; yalnız D < gün (sızıntı yok, süzme burada tekrar yapılır). İlk ~63 işlem günü (rs63) Q üretmez.
 *  - Açılış aralığı 5 dk (varsayılan) ya da 30 dk; 15 dk değil (firsat sarmalayıcısı gibi 15 dk zorunluluğu yok).
 *  - Strike: firsat ile aynı oto k kuralı (S ± k × EM0). Çıkış: Kaan prim kuralları (motor), dayanak hedefi çıkış değil.
 *  - Gece taşıma yok: pozisyon 15:45 ET'de kapanır (motor).
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type DayInfo, type Strategy, type StratCtx, type StratEntry } from './types.ts';
import { vwapAt, openRange } from './util.ts';
import { runSetups } from '../../signals/setups/index.ts';
import type { SetupCtx, SetupId } from '../../signals/types.ts';
import { autoK, otmDistance } from '../../signals/otm.ts';
import { profileFor } from '../../signals/profiles.ts';
import { qullDaily, type QDaily } from '../../signals/qull/daily.ts';

export interface QullParams extends CommonParams { orMin: 5 | 30; volMult: number; gapMult: number }
const SESSION_MIN = 390, SESSION_OPEN_MIN = 570;

const qdMemo = new Map<string, QDaily | null>();
/** Gün için Qullamaggie bağlamı (yalnız önceki günler). Aynı ticker/gün/veri boyu için önbellekli. */
export function qdOf(info: DayInfo): QDaily | null {
  if (!info.daily) return null;
  const key = `${info.ticker}|${info.date}|${info.daily.length}|${info.spyDaily?.length ?? -1}`;
  const hit = qdMemo.get(key);
  if (hit !== undefined) return hit;
  const past = info.daily.filter(b => b.D < info.date);
  const spy = info.spyDaily ? info.spyDaily.filter(b => b.D < info.date) : null;
  const q = qullDaily(past, spy && spy.length ? spy : null);
  qdMemo.set(key, q);
  return q;
}

/** Q setup bağlamı: firsat sarmalayıcısından farklı olarak 5 ve 30 dk açılış aralıkları, günlük bağlam ve Q parametreleri. */
export function qCtxOf(c: StratCtx, id: SetupId, qd: QDaily | null, p: QullParams): SetupCtx | null {
  const bars = c.bars, n = bars.length;
  if (n < 2) return null;
  const vw = vwapAt(bars);
  if (vw == null) return null;
  const last = bars[n - 1];
  const lookback = bars.slice(Math.max(0, n - 21), n - 1);
  const avgV = lookback.length ? lookback.reduce((s, b) => s + b.v, 0) / lookback.length : 0;
  const em = c.day.em0 ?? 0;
  const left = Math.max(0, SESSION_MIN - c.m);
  const o5 = openRange(bars, 5), o30 = openRange(bars, 30);
  return {
    ticker: c.ticker, now: c.t, etMin: SESSION_OPEN_MIN + c.m, dte: c.day.dte, bars, S: c.S, em, emRemain: em * Math.sqrt(left / SESSION_MIN),
    vwap: vw, orHi: o5?.high ?? NaN, orLo: o5?.low ?? NaN, volRatio: avgV > 0 ? last.v / avgV : NaN,
    align: { bull: c.S > vw, bear: c.S < vw }, allowed: [id], newsImpulse: null, walls: null, ivRank: null, rv10: null, atmIv: null,
    qd, orWin: { m5: o5, m30: o30 }, qp: { orMin: p.orMin, volMult: p.volMult, gapMult: p.gapMult },
  };
}

const mk = (id: SetupId, name: string, desc: string): Strategy<QullParams> => ({
  id: `qull-${id.toLowerCase()}`, name, description: desc,
  universe: ['QQQ', 'GLD', 'SLV', 'NVDA', 'MU', 'INTC'],
  defaults: { ...COMMON_DEFAULTS, startMin: 5, endMin: 210, targetDelta: 0.5, maxPerDay: 2, orMin: 5, volMult: 1.5, gapMult: 1.5 },
  space: id === 'Q2' ? { orMin: [5, 30], volMult: [1.5, 2], gapMult: [1.5, 2] } : { orMin: [5, 30], volMult: [1.5, 2] },
  evaluate(c: StratCtx, p: QullParams): StratEntry | null {
    if (!inWindow(c.m, p)) return null;
    const sc = qCtxOf(c, id, qdOf(c.day), p);
    if (!sc) return null;
    const cand = runSetups(sc)[0];
    if (!cand) return null;
    const em = c.day.em0;
    if (em == null || !(em > 0)) return null;
    const k = autoK({ rule: profileFor(c.ticker).otm, ratios: c.day.ratios ?? [], ivRank: null });
    const sg = cand.dir === 'bull' ? 1 : -1;
    return {
      dir: cand.dir === 'bull' ? 'call' : 'put', undTarget: cand.und.target, undStop: cand.und.stop, targetDelta: p.targetDelta,
      strike: c.S + sg * otmDistance(k.k, em),
      note: `${cand.reason.join(' · ')} · k=${k.k.toFixed(2)} (${k.source})`,
    };
  },
});

export const qullStrategies: Strategy<QullParams>[] = [
  mk('Q1', 'Qullamaggie Q1: ORH kırılımı (uyarlama)', 'Trend + RS + daralma + yakın tepe + ORH kırılımı (Q1)'),
  mk('Q1S', 'Qullamaggie Q1S: ORL kırılımı, zayıf isim (uyarlama)', 'Ayna: trend aşağı + RS negatif + yakın dip + ORL kırılımı (Q1S)'),
  mk('Q2', 'Qullamaggie Q2: Episodic Pivot (uyarlama)', 'Gap + ilk 15 dk hacim + gap yönünde açılış aralığı kırılımı (Q2)'),
  mk('Q3', 'Qullamaggie Q3: parabolik short (deneysel)', 'Uzama + ORL kırılımı / VWAP geri alınamaması (Q3, varsayılan uygulamada kapalı)'),
];
