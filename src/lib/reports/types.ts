/* Rapor girdi/çıktı tipleri (saf). Sunucu veriyi toplar, bu tiplerle metni ve yapılandırılmış bölümleri üretir; uygulama aynı Report'u gösterir. */
import type { ReportKind } from './schedule.ts';
import type { MacroLite } from '../calendar/releases.ts';
import type { RegimeKind, TapeBar, Band } from '../market/regime.ts';
export type { MacroLite };

export interface Move { name: string; pct: number | null; price?: number | null }
export interface NewsLite { title: string; source: string; at: number; tickers: string[] }
export interface WallSnap { spot: number | null; callWall: number | null; putWall: number | null; flip: number | null; maxPain: number | null; expiry: string | null; at: number }
export interface FlowAgg { ticker: string; expiry: string; side: 'call' | 'put'; strike: number; contracts: number; premium: number }
export interface SmaRow { ticker: string; price: number | null; sma20: number | null; sma50: number | null; sma200: number | null }

/** Eğilim kararı: CALL (yukarı) · PUT (aşağı) · BEKLE (yatay / veri yok) */
export type Bias = 'CALL' | 'PUT' | 'BEKLE';
/** Etki düzeyi (takvim, haber) */
export type Impact = 'high' | 'med' | 'low';
/** Renk tonu: pozitif (yeşil), negatif (kırmızı), uyarı (sarı), nötr metin, soluk (veri yok) */
export type Tone = 'pos' | 'neg' | 'warn' | 'text' | 'muted';

export interface Chip { label: string; value: string; sub?: string; tone: Tone }
export interface KeyLevel { label: string; value: string }
/** Bir duvar seti: call duvarı, put duvarı, gamma flip (kayma okları için önceki değerle karşılaştırılır) */
export interface WallLevels { callWall: number | null; putWall: number | null; gammaFlip: number | null }
export interface WallRow {
  ticker: string; spot: number | null; callWall: number | null; putWall: number | null; gammaFlip: number | null; maxPain: number | null;
  prev: WallLevels | null;          // açılış (canlı) ya da önceki kapanış (zincir); yoksa null
  prevLabel: string | null;         // "açılış" ya da "12/11"
  source: string;                   // "canlı zincir" ya da "önceki kapanış (12/11) zincirine göre"
}
export interface CalItem { time: string; istTime: string; name: string; impact: Impact; released: boolean; verified: boolean; tomorrow: boolean }
export interface NewsCard { headline: string; source: string; time: string; impact: Impact; tag: string }
export interface FlowTop { label: string; side: 'call' | 'put'; contracts: number; premium: number }
export interface FlowSection { known: boolean; callPremium: number; putPremium: number; callShare: number | null; source: string; top: FlowTop[] }
export interface ShiftRow { ticker: string; what: string; from: number; to: number; arrow: '↑' | '↓' | '=' }
export interface EodReview {
  expected: Bias | null;            // sabah (piyasa öncesi) beklentisi; yoksa null
  actual: Bias;                     // gün sonu eğilimi
  result: 'hit' | 'miss' | 'veri yok';
  outcome: string;                  // "watch ort. +0,42%"
  shifts: ShiftRow[];
  plan: string;                     // yarın planı (1 cümle)
}
/** Ara rapor senaryosu: devam / dönüş / yatay; pct tam sayı (üçü toplam 100) */
export interface IntraScenario { key: 'devam' | 'donus' | 'yatay'; label: string; pct: number; trigger: string }
/** Ara rapor: şu ana kadar (recap) + rejim + senaryolar (kural tabanlı tahmin). Yalnız intra türlerinde. */
export interface IntraView {
  method: string; ticker: string; asOf: number;
  kind: RegimeKind; label: string; reason: string;
  bias: Bias | null;                // null: rejim "erken" → eğilim kuralı (kayan ortalama) kullanılır
  dir: 'up' | 'down' | null;
  band: Band | null;
  plan: string;
  recap: string[];
  scenarios: IntraScenario[];
  reversal: string | null;          // dönüş adayı / onaylı dönüş özeti
}
export interface ReportSections {
  v: 1;
  summary: { bias: Bias; dataOk: boolean; keyLevels: KeyLevel[]; plan: string; regimeLabel?: string };
  intra?: IntraView | null;         // yalnız ara raporlar (eski satırlarda yok)
  metrics: Chip[];
  walls: WallRow[];
  calendar: CalItem[];
  news: NewsCard[];
  newsOk: boolean;                  // false: haber kaynağı çalışmadı → "veri alınamadı"
  flow: FlowSection;
  eod: EodReview | null;
  failures: string[];
}

/** Tek rapor için tüm girdiler. Veri alınamayan alan boş/null; metin "veri alınamadı" yazar, düşmez. */
export interface ReportInput {
  kind: ReportKind; day: string; nowMs: number;
  watch: string[];                                  // izleme tickerları (sunucu FLOW_TICKERS)
  asia: Move[]; europe: Move[]; futures: Move[]; preMarket: Move[];
  moves: Move[];                                    // açılıştan beri (intra) / gün değişimi (eod)
  vix?: Move | null;                                // VIX (^VIX): fiyat ve gün/seans değişimi
  walls: { ticker: string; open: WallSnap | null; now: WallSnap | null }[];
  flow: FlowAgg[];
  news: NewsLite[]; newsOk: boolean;
  macro: { today: MacroLite[]; tomorrow: MacroLite[] };
  earnings: { ticker: string; date: string | null }[] | null;   // null = bilanço bilgisi alınamadı
  sma: SmaRow[];
  failures: string[];                               // "Yahoo: ^N225 alınamadı" gibi
  /** Ara raporlar: QQQ / SPY 1 dk barları (yalnız rapor anından önce tamamlanmış olanlar; sunucu kırpar) */
  tape?: { ticker: string; bars: TapeBar[] }[];
  flowKnown?: boolean;                              // false: o an için akış/duvar kaydı yok → "veri alınamadı" (undefined = var)
  /** Aynı günün piyasa öncesi raporundan CALL/PUT/BEKLE (yalnız gün sonu: beklenti–gerçek karşılaştırması). Yoksa null. */
  morningBias?: Bias | null;
  /**
   * Önceki kapanış (tarihsel EOD zinciri) ile kurulmuş rapor. Varsa başlıklar bu etiketleri kullanır; yoksa canlı başlıklar.
   * Intra: duvarlar ve birikim 12/11 kapanış zincirinden (açılış anı yok → kayma ölçülemez; "Gözlem" notları yazılmaz,
   * çünkü spot önceki kapanıştır). EOD: duvar kayması önceki kapanış → gün sonu zinciri (yoksa "veri alınamadı").
   */
  basis?: { wallsHead: string; openLabel?: string; flowHead: string; source: string };
}

export interface Report { kind: ReportKind; day: string; ts: number; title: string; body: string; pushTitle: string; pushBody: string; sections: ReportSections }
