/* Koç (işlem koçu) tipleri. Uygulama ve sunucu aynı şekli kullanır. Sırsız. */

export type OptSide = 'CALL' | 'PUT';

/** Görüntüden okunan tek işlem (model çıktısı, doğrulanmış) */
export interface ExtractedTrade {
  ticker: string;            // ör. QQQ
  side: OptSide;
  strike: number;
  expiry: string;            // YYYY-MM-DD
  qty: number | null;
  entryTime: string | null;  // YYYY-MM-DDTHH:MM (İstanbul)
  entryPrice: number | null; // prim, $
  exitTime: string | null;
  exitPrice: number | null;
  status: 'kapali' | 'acik';
  confidence: 'yuksek' | 'orta' | 'dusuk';
}

/** Kural kontrolü (deterministik) */
export interface RuleFact { kural: string; durum: 'uyuyor' | 'uymuyor' | 'bilinmiyor'; aciklama: string }

/** Modelin ürettiği yorum (sayı YOK: sayılar kodda hesaplanır). Yalnız bu alanlar modelden beklenir. */
export interface ModelFeedback {
  neOldu: { oncesi: string; sirasinda: string; sonrasi: string };
  cikis: { karar: 'dogru' | 'erken' | 'yanlis' | 'belirsiz'; neden: string };
  giris: { karar: 'iyi' | 'kovalama' | 'riskli' | 'belirsiz'; neden: string };
  strike: { karar: 'uygun' | 'yakin' | 'uzak' | 'belirsiz'; neden: string };
  kacanFirsatYorum: string;
  birDahakine: [string, string, string];
  karne: { disiplinCikis: number; girisZamanlamasi: number; strikeSecimi: number; aciklama: string };
}

export type Emoji = '✅' | '⚠️' | '❌' | '❔';

/** Kart (uygulamaya giden): sayılar kodda, yorumlar modelden */
export interface TradeReport {
  header: {
    ticker: string; strike: number; side: 'C' | 'P'; expiry: string; dte: number | null;
    entryIst: string | null; entryPrice: number | null; exitIst: string | null; exitPrice: number | null;
    qty: number | null; status: 'kapali' | 'acik';
    grossPnl: number | null; fees: number | null; netPnl: number | null;
  };
  neOldu: { oncesi: string; sirasinda: string; sonrasi: string; sayilar: Record<string, number | null> };
  cikis: { emoji: Emoji; karar: ModelFeedback['cikis']['karar']; neden: string };
  giris: { emoji: Emoji; karar: ModelFeedback['giris']['karar']; neden: string; vwapUzaklikPct: number | null; pencere: 'icinde' | 'disinda' | 'bilinmiyor' };
  strike: { emoji: Emoji; karar: ModelFeedback['strike']['karar']; neden: string; otmPct: number | null; otmPerEm: number | null };
  kacanFirsat: { lehePctTutarken: number | null; lehePctSonra: number | null; optTutarkenTahmini: number | null; optSonraTahmini: number | null; etiket: 'tahmini'; yorum: string };
  birDahakine: string[];
  karne: ModelFeedback['karne'];
  rules: RuleFact[];
  noData: string[];
  model: string;
}

/** Karne (günlük özet) */
export interface Karne {
  ozet: string;
  guclu: string[];
  tekrarlayanHata: string[];
  yarinOdak: string;
}

/** Koçluk sonucu (kaydedilen) */
export interface CoachedTrade {
  id: number;
  day: string;
  ts: number;
  trade: ExtractedTrade;
  rules: RuleFact[];
  report: TradeReport | null;
  context: Record<string, unknown> | null;
  model: string;
}

export type Conf = 'yuksek' | 'orta' | 'dusuk';
export type FillSide = 'buy' | 'sell';

/** Görüntüden okunan tek dolum (emir satırı). Sunucu SQLite'ta saklar; eşleştirme src/lib/coach/fills.ts. */
export interface Fill {
  id: number;
  t: string;          // YYYY-MM-DDTHH:MM (İstanbul)
  tk: string;         // dayanak, ör. QQQ
  exp: string;        // vade YYYY-MM-DD
  k: number;          // strike
  cp: 'C' | 'P';
  q: number;          // adet (pozitif)
  side: FillSide;     // buy = alış/açılış, sell = satış/kapanış
  px: number;         // prim $ (opsiyon fiyatı)
  conf: Conf;
}

/** Uygulamanın Koç ekranı için günün görünümü (sunucu GET /coach). */
export type CoachFillView = Fill;
export interface CoachTradeView {
  sig: string;
  tk: string; exp: string; k: number; cp: 'C' | 'P';
  qty: number;
  entryT: string; entryPx: number;
  exitT: string; exitPx: number;
  legs: number;
  conf: Conf;
  status: 'hazir' | 'bekliyor';          // hazir: rapor var; bekliyor: koçluk henüz üretilmedi
  ts: number;                            // rapor kayıt zamanı (ms); bekliyorda 0
  report: TradeReport | null;
}
export interface CoachOpenView {
  tk: string; exp: string; k: number; cp: 'C' | 'P';
  qty: number;             // kalan (açık) adet
  entryT: string; entryPx: number;
  closedQty: number;       // kısmen kapatılmış kısım
  closedPx: number | null;
}
export interface CoachDayView {
  day: string;
  fills: CoachFillView[];        // günün dolumları
  trades: CoachTradeView[];      // günün (giriş tarihine göre) eşleşmiş işlemleri
  open: CoachOpenView[];         // açık pozisyonlar (saklama penceresi içinde)
  orphans: CoachFillView[];      // eşleşmeyen satışlar (açılışı ekran görüntülerinde yok)
  pending: number;               // koçluk bekleyen eşleşmiş işlem sayısı
  karne: { day: string; ts: number; model: string; body: Karne } | null;
  usage: { calls: number; inTok: number; outTok: number };
}
