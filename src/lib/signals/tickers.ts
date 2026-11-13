/* Sinyal tickerları: doğrulama, varsayılan liste, 0–3 DTE uyarısı. Saf. */
export const DEFAULT_TICKERS = ['QQQ', 'GLD', 'SLV', 'NVDA'];
export const MAX_TICKERS = 8;
/** loadSymbol (src/lib/market/index.ts) ile aynı biçim kuralı */
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
export type NormResult = { ok: true; ticker: string } | { ok: false; reason: string };

export function normalizeTicker(raw: string, list: string[]): NormResult {
  const t = raw.trim().toUpperCase();
  if (!TICKER_RE.test(t)) return { ok: false, reason: 'Geçersiz sembol' };
  if (list.includes(t)) return { ok: false, reason: 'Zaten listede' };
  if (list.length >= MAX_TICKERS) return { ok: false, reason: `En fazla ${MAX_TICKERS} ticker` };
  return { ok: true, ticker: t };
}

/** Zincirdeki vadelerin DTE değerleri; 0–3 içinde vade yoksa Türkçe uyarı */
export function dteWarning(sym: string, dtes: number[]): string | null {
  if (dtes.some(d => d >= 0 && d <= 3)) return null;
  return `${sym}: bu sembolde 0–3 DTE vade yok, yalnızca 1–3 DTE / haftalık vade`;
}
