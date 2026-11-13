/* Radar (Aşama B–D) ortak tipleri. Saf TS: src/lib kuralı gereği React / Node yerleşiği yok. */
import type { Bar } from '../odte/analytics.ts';
import type { Chain } from '../market/types.ts';
import type { SkewMetrics } from '../prob/implied.ts';

export type Direction = 'bull' | 'bear' | 'neutral' | 'vol';
export type SignalKind = 'pcSurge' | 'unusual' | 'oiBuild' | 'ivJump' | 'skew' | 'complacency' | 'panic' | 'pin' | 'gamma' | 'sector' | 'earnings' | 'trend';

/** Bir dedektörün ürettiği tek bulgu. severity 0..1, facts Türkçe metin üretiminde kullanılır. */
export interface Signal {
  id: string; ticker: string; kind: SignalKind; severity: number; direction: Direction;
  facts: Record<string, number | string>; at: number;
}

/** Bir sembol için anlık görüntü (tek tarama turu). Tüm alanlar buildSnapshot ile doldurulur. */
export interface Snapshot {
  ticker: string; isEtf: boolean; spot: number; changePct: number; now: number;
  source: string; dataAgeSec: number; delayedMin: number;
  bars: Bar[];                              // bugünkü normal seans barları
  vwap: number | null; orHigh: number | null; orLow: number | null; ema9: number | null; ema21: number | null;
  expiry: string; dte: number; chain: Chain; // en yakın vade zinciri
  expectedMove: number | null;              // ATM straddle ($), 0DTE için günlük beklenen hareket
  emPct: number | null;                     // expectedMove / spot (oran)
  atmIv: number | null;                     // ondalık
  atmIvSession0: number | null;             // seansın ilk taramasındaki ATM IV
  skew: SkewMetrics | null; rr25: number | null;
  probUp: number | null;                   // zımni P(S_T > spot), risk-nötr (Aşama A)
  callWall: number | null; putWall: number | null; maxPain: number | null; flip: number | null; netGex: number | null;
  pcVol: number | null; totalVol: number | null; avgContractVol: number | null;
  prevOi: Record<string, number> | null;    // `${C|P}${strike}` → önceki gün sonu OI
  sector: { ticker: string; changePct: number } | null;
  earnings: { date: string; days: number } | null;   // days: takvim günü (negatif = geçti)
  earningsImpliedPct: number | null;        // bilanço vadesindeki zımni hareket (%)
  earningsHistPct: number | null;           // son 8 bilançonun ortalama gerçekleşen hareketi (%)
}

/** Günlük kayıt (gün sonu / son tarama). Taban çizgisi bunlardan türetilir. */
export interface DayRecord {
  date: string; ticker: string; pcVol: number | null; totalVol: number | null; avgContractVol: number | null;
  atmIv: number | null; rr25: number | null; close: number | null;
}

/** Taban çizgisi: son 20 gün ve 1 yıl (en fazla 252 işlem günü) */
export interface Baseline {
  n: number;                                // kullanılabilir gün sayısı (IV için)
  pcVol20: number | null; totalVol20: number | null; avgContractVol20: number | null;
  ivHist: number[];                         // 1 yıl ATM IV geçmişi (bugün hariç)
  rv10: number | null; rv20: number | null; // yıllık realize oynaklık (ondalık)
  rr25Mean: number | null; rr25Std: number | null;
  n20: number;                              // rr/pcVol için gün sayısı
}
