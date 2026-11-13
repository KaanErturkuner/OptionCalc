/*
 * Sunucu MarketData proxy'si: izinli uç noktalar ve URL yardımcıları. Saf (sunucu da uygulama da kullanır).
 * Uygulama: `${FLOW_BASE_URL}/api/md` + MarketData yolu (sorgu dâhil), başlık `x-app-key`.
 * Sunucu yalnızca burada izinli olan yolları iletir; diğer her şey 403.
 */
export const MD_PROXY_PREFIX = '/api/md';
export const APP_KEY_HEADER = 'x-app-key';

const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAXAGE = /^\d{1,4}(s|sec|min)$/;
const CHAIN_QS = new Set(['expiration', 'dte', 'from', 'to', 'strikeLimit', 'range', 'side', 'mode', 'maxage',
  'minVolume', 'minOpenInterest', 'minBid', 'maxBid', 'minAsk', 'maxAsk', 'maxBidAskSpreadPct', 'weekly', 'monthly', 'quarterly', 'month', 'year']);
const EXP_QS = new Set<string>();
const QUOTE_QS = new Set<string>();
const CANDLE_QS = new Set(['from', 'to']);

/** MarketData yolunun ve sorgusunun izinli olup olmadığı. Dönen: null = izinli, string = Türkçe hata. */
export function checkMdRequest(path: string, query: URLSearchParams | Record<string, string>): string | null {
  const q = query instanceof URLSearchParams ? Object.fromEntries(query.entries()) : query;
  const keys = Object.keys(q);
  for (const k of keys) if (String(q[k]).length > 64) return 'Parametre çok uzun';
  let allowed: Set<string>, m: RegExpExecArray | null;
  if ((m = /^\/stocks\/quotes\/([^/]+)\/$/.exec(path))) { allowed = QUOTE_QS; if (!SYM.test(m[1])) return 'Geçersiz sembol'; }
  else if ((m = /^\/options\/expirations\/([^/]+)\/$/.exec(path))) { allowed = EXP_QS; if (!SYM.test(m[1])) return 'Geçersiz sembol'; }
  else if ((m = /^\/options\/chain\/([^/]+)\/$/.exec(path))) {
    allowed = CHAIN_QS; if (!SYM.test(m[1])) return 'Geçersiz sembol';
    if (q.mode != null && !['live', 'cached', 'delayed'].includes(q.mode)) return 'Bu mod izinli değil';
    if (q.maxage != null && !MAXAGE.test(q.maxage)) return 'Geçersiz maxage';
  }
  else if ((m = /^\/stocks\/candles\/1\/([^/]+)\/$/.exec(path))) {
    allowed = CANDLE_QS; if (!SYM.test(m[1])) return 'Geçersiz sembol';
    if (q.from != null && !DAY.test(q.from)) return 'Geçersiz tarih';
    if (q.to != null && !DAY.test(q.to)) return 'Geçersiz tarih';
  }
  else return 'Bu uç nokta izinli değil';
  for (const k of keys) if (!allowed.has(k)) return `Parametre izinli değil: ${k}`;
  return null;
}

/** Uygulamanın kullandığı MarketData yolu → sunucu URL'si (sorgu yolda kalır) */
export function mdProxyUrl(base: string, mdPath: string): string {
  return `${base.replace(/\/+$/, '')}${MD_PROXY_PREFIX}${mdPath.startsWith('/') ? mdPath : '/' + mdPath}`;
}
/** Sunucu API yolu → URL (since / limit: bkz. server/README.md) */
export function flowEventsUrl(base: string, opts: { sinceId?: number; limit?: number; days?: number } = {}): string {
  const p = new URLSearchParams();
  if (opts.days != null) p.set('days', String(Math.min(5, Math.max(1, Math.floor(opts.days)))));
  if (opts.sinceId != null) p.set('sinceId', String(Math.max(0, Math.floor(opts.sinceId))));
  if (opts.limit != null) p.set('limit', String(Math.min(500, Math.max(1, Math.floor(opts.limit)))));
  const qs = p.toString();
  return `${base.replace(/\/+$/, '')}/flow${qs ? '?' + qs : ''}`;
}
/** Expo push token biçimi: ExponentPushToken[...] veya ExpoPushToken[...] */
export function isExpoPushToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,128}\]$/.test(t);
}
