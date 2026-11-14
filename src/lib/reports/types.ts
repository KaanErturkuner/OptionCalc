/* Rapor girdi/çıktı tipleri (saf). Sunucu veriyi toplar, bu tiplerle metni üretir; uygulama aynı Report'u gösterir. */
import type { ReportKind } from './schedule.ts';
import type { MacroLite } from '../calendar/releases.ts';
export type { MacroLite };

export interface Move { name: string; pct: number | null; price?: number | null }
export interface NewsLite { title: string; source: string; at: number; tickers: string[] }
export interface WallSnap { spot: number | null; callWall: number | null; putWall: number | null; flip: number | null; maxPain: number | null; expiry: string | null; at: number }
export interface FlowAgg { ticker: string; expiry: string; side: 'call' | 'put'; strike: number; contracts: number; premium: number }
export interface SmaRow { ticker: string; price: number | null; sma20: number | null; sma50: number | null; sma200: number | null }

/** Tek rapor için tüm girdiler. Veri alınamayan alan boş/null; metin "veri alınamadı" yazar, düşmez. */
export interface ReportInput {
  kind: ReportKind; day: string; nowMs: number;
  watch: string[];                                  // izleme tickerları (sunucu FLOW_TICKERS)
  asia: Move[]; europe: Move[]; futures: Move[]; preMarket: Move[];
  moves: Move[];                                    // açılıştan beri (intra) / gün değişimi (eod)
  walls: { ticker: string; open: WallSnap | null; now: WallSnap | null }[];
  flow: FlowAgg[];
  news: NewsLite[]; newsOk: boolean;
  macro: { today: MacroLite[]; tomorrow: MacroLite[] };
  earnings: { ticker: string; date: string | null }[] | null;   // null = bilanço bilgisi alınamadı
  sma: SmaRow[];
  failures: string[];                               // "Yahoo: ^N225 alınamadı" gibi
  flowKnown?: boolean;                              // false: o an için akış/duvar kaydı yok → "veri alınamadı" (undefined = var)
  /**
   * Önceki kapanış (tarihsel EOD zinciri) ile kurulmuş rapor. Varsa başlıklar bu etiketleri kullanır; yoksa canlı başlıklar.
   * Intra: duvarlar ve birikim 12/11 kapanış zincirinden (açılış anı yok → kayma ölçülemez; "Gözlem" notları yazılmaz,
   * çünkü spot önceki kapanıştır). EOD: duvar kayması önceki kapanış → gün sonu zinciri (yoksa "veri alınamadı").
   */
  basis?: { wallsHead: string; openLabel?: string; flowHead: string };
}

export interface Report { kind: ReportKind; day: string; ts: number; title: string; body: string; pushTitle: string; pushBody: string }
