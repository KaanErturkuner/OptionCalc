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
