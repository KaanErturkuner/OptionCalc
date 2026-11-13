/* Haber katmanı tipleri (Aşama C) */
export type NewsKind = 'news' | 'filing' | 'insider' | 'earnings' | 'macro';
export interface NewsItem {
  id: string; tickers: string[]; title: string; source: string; url: string; publishedAt: number;
  kind: NewsKind; sentiment?: number; /* −1..1 */ tags: string[];
}
