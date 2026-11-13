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

/** Modelin ürettiği tek işlem geri bildirimi */
export interface TradeFeedback {
  neYaptin: string;
  dogruMu: 'evet' | 'kismen' | 'hayir';
  dogruAciklama: string;
  neden: string;
  birDahakine: string;
  cikis: 'erken' | 'gec' | 'iyi_stop' | 'dogru' | 'kapatmamaliydin' | 'belirsiz';
  etiketler: string[];       // ör. acele, erken_cikis, gec_giris, pencere_disi, dte_disi
}

/** Karne (günlük özet) */
export interface Karne {
  ozet: string;
  guclu: string[];
  tekrarlayanHata: string[];
  yarinOdak: string;
}

/** Koçluk sonucu (kaydedilen): işlem + geri bildirim + kurallar + bağlam özeti */
export interface CoachedTrade {
  id: number;
  day: string;
  ts: number;
  trade: ExtractedTrade;
  rules: RuleFact[];
  feedback: TradeFeedback | null;
  context: Record<string, unknown> | null;
  model: string;
}
