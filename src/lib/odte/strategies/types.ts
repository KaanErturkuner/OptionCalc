/*
 * Takılabilir (pluggable) strateji arayüzü. Strateji = saf fonksiyon: o ana kadarki TAMAMLANMIŞ barlar + önceden hesaplanmış
 * göstergeler (Features) + tembel zincir → giriş kararı (yön + dayanak hedef/stop) ya da null. Kontrat seçimi, fiyatlama,
 * maliyet ve çıkış simülasyonu motorun (backtest/engine.mts) işidir; böylece her strateji aynı veride aynı kurallarla kıyaslanır.
 * Uygulama tarafında da aynı modüller çağrılabilir (Node'a özgü bağımlılık yok).
 */
import type { Bar } from '../analytics.ts';
import type { Chain } from '../../market/types.ts';
import type { Features } from '../signal.ts';
import type { DailyBar } from '../../signals/qull/daily.ts';

export type Dir = 'call' | 'put';
export interface DayInfo {
  ticker: string; date: string; dte: number;
  prevClose: number | null; openPx: number;
  /** Günlük beklenen hareket ($): ilk değerlendirmedeki ATM straddle / √(1+dte) (dte>0 vadeler için kaba ölçek) */
  em0: number | null;
  /** Önceki günlerin OTM oynaklık oranları (oto k için; yalnız geçmiş günler, sızıntı yok). Yoksa boş. */
  ratios?: number[];
  /** Qullamaggie günlük barlar (yalnız önceki günler; backtest'te D < gün süzülür). Yoksa Q setupları üretmez. */
  daily?: DailyBar[];
  /** SPY günlük barları (RS için; yoksa RS bileşeni atlanır) */
  spyDaily?: DailyBar[];
}
export interface StratCtx {
  ticker: string; S: number; t: number;
  /** 09:30 ET'den bu yana dakika */
  m: number;
  /** Bugünün tamamlanmış 1 dk seans barları (t'ye kadar) */
  bars: Bar[];
  /** Göstergeler (F.bars kullanılmamalı → ctx.bars) */
  F: Features;
  day: DayInfo;
  /** Tembel zincir (modellenmiş ya da kaydedilmiş gerçek) */
  chain: (side?: Dir) => Chain;
  /** Aynı hisse-gün içinde değerlendirmeler arası kalıcı not defteri (ör. "ilk kırılım oldu mu") */
  mem: Record<string, unknown>;
  /** Başka bir sembolün bugünkü TAMAMLANMIŞ 1 dk barları (piyasa rejimi / sektör için; yoksa null) */
  peer?: (symbol: string) => Bar[] | null;
}
export interface StratEntry {
  dir: Dir;
  undTarget: number; undStop: number;
  /** Zaman stopu: girişten en fazla bu kadar dakika tut */
  maxHoldMin?: number;
  /** Bu giriş için hedef delta (yoksa parametredeki targetDelta) */
  targetDelta?: number;
  /** Hedef strike (verilirse delta yerine buna en yakın likit kontrat seçilir) */
  strike?: number;
  /** Strateji tanımlı çıkış: i. bar tamamlandığında true → sonraki barın açılışında çık (ör. yüksek hacimli ters mum) */
  exitCheck?: (bars: Bar[], i: number) => boolean;
  score?: number; note?: string;
}
/** Tüm stratejilerde ortak: zaman penceresi + kontrat seçimi + günlük limit */
export interface CommonParams {
  startMin: number; endMin: number;
  targetDelta: number; maxSpread: number; minVol: number; minOI: number;
  maxPerDay: number;
  /** Atlanacak ET pencereleri, dakika [başlangıç, bitiş) — ör. öğle durgunluğu [150, 240] */
  skip?: [number, number][];
}
export const COMMON_DEFAULTS: CommonParams = { startMin: 15, endMin: 180, targetDelta: 0.5, maxSpread: 0.1, minVol: 50, minOI: 200, maxPerDay: 2 };
export type ParamSpace<P> = { [K in keyof P]?: readonly P[K][] };
export interface Strategy<P extends CommonParams = CommonParams> {
  id: string; name: string; description: string;
  /** Önerilen sembol evreni (motor yine de istenen tüm sembollerde çalıştırabilir) */
  universe?: string[];
  defaults: P;
  /** Rejim/sektör için gereken diğer semboller (motor bunların 1 dk barlarını `ctx.peer` ile verir) */
  peers?: string[];
  /** Arama uzayı (walk-forward optimizasyonu için ızgara değerleri) */
  space: ParamSpace<P>;
  evaluate(ctx: StratCtx, p: P): StratEntry | null;
}
export const inWindow = (m: number, p: CommonParams) => m >= p.startMin && m <= p.endMin && !(p.skip ?? []).some(([a, b]) => m >= a && m < b);
