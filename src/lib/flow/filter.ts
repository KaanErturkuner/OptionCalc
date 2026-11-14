/*
 * Akış filtreleri (Liste ve Dağılım ortak). Saf: React / AsyncStorage / Date.now YOK; "şimdi" nowMs ile verilir.
 * Gün: ET takvimi (days.ts + usmarket.ts). Vade: 0DTE = expiry === day; Haftalık = Cuma vadesi
 * (Cuma tatilse önceki işlem günü; expiry.ts ile aynı kural).
 */
import { addDaysStr, etDate, isTradingDay, prevTradingDay } from '../usmarket.ts';
import { DEFAULT_TICKERS, type FlowEvent } from './model.ts';

export type DayFilter = 'bugun' | 'dun' | 'uc';
export type SideFilter = 'all' | 'call' | 'put';
export type ExpiryFilter = 'all' | 'zero' | 'weekly';
export const MIN_PREM_OPTIONS = [0, 50_000, 100_000, 500_000, 1_000_000] as const;
export type MinPrem = typeof MIN_PREM_OPTIONS[number];

export interface FlowFilters {
  ticker: string | null;   // null = Hepsi
  side: SideFilter;
  day: DayFilter;          // 'uc' = tüm yüklü pencere (3 gün)
  minPrem: MinPrem;
  expiry: ExpiryFilter;
}
export const DEFAULT_FILTERS: FlowFilters = { ticker: null, side: 'all', day: 'uc', minPrem: 0, expiry: 'all' };

const dow = (s: string) => new Date(s + 'T12:00:00Z').getUTCDay();

/** Vade türü: 0DTE (vade = olayın kendi işlem günü), Haftalık (Cuma veya tatil Cuma'sının önceki işlem günü), diğer */
export function expiryKind(e: Pick<FlowEvent, 'expiry' | 'day'>): 'zero' | 'weekly' | 'other' {
  if (e.expiry === e.day) return 'zero';
  return isWeeklyExpiry(e.expiry) ? 'weekly' : 'other';
}

/** Vade bir haftalık (Cuma) seri vadesi mi? Cuma işlem günüyse Cuma; tatilse aynı haftanın önceki işlem günü. */
export function isWeeklyExpiry(expiry: string): boolean {
  const w = dow(expiry);
  if (w === 5) return true;
  if (w < 1 || w > 4) return false;               // hafta sonu vadesi olamaz
  const fri = addDaysStr(expiry, 5 - w);          // aynı haftanın Cuma'sı
  return !isTradingDay(fri) && prevTradingDay(fri) === expiry;
}

/** Bugün ve Dün (ET). Hafta sonu / tatilde Bugün işlem günü değildir; Bugün bilerek son işlem gününe çevrilmez. */
export function dayTargets(nowMs: number): { bugun: string; dun: string } {
  const today = etDate(nowMs);
  return { bugun: today, dun: prevTradingDay(addDaysStr(today, -1)) };
}

/** Yüklü olaylardaki tickerlar: önce DEFAULT_TICKERS sırasında (yüklü olanlar), sonra kalanlar alfabetik */
export function tickersIn(events: Pick<FlowEvent, 'ticker'>[]): string[] {
  const present = new Set(events.map(e => e.ticker));
  const head = DEFAULT_TICKERS.filter(t => present.has(t));
  const rest = [...present].filter(t => !DEFAULT_TICKERS.includes(t)).sort();
  return [...head, ...rest];
}

/** Olayları filtreler (girdi sırası korunur). `side`: 'all' ise taraf filtresi uygulanmaz. */
export function applyFlowFilters(events: FlowEvent[], f: FlowFilters, nowMs: number): FlowEvent[] {
  const { bugun, dun } = dayTargets(nowMs);
  return events.filter(e => {
    if (f.ticker && e.ticker !== f.ticker) return false;
    if (f.side !== 'all' && e.side !== f.side) return false;
    if (f.day === 'bugun' && e.day !== bugun) return false;
    if (f.day === 'dun' && e.day !== dun) return false;
    if (f.minPrem > 0 && !(e.prem >= f.minPrem)) return false;
    if (f.expiry !== 'all' && expiryKind(e) !== f.expiry) return false;
    return true;
  });
}

/** Ayarlardan gelen (depolanmış) değeri doğrular; geçersiz alan varsayılana döner. */
export function validFilters(raw: unknown): FlowFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string | number>(v: unknown, allowed: readonly T[], d: T): T => (allowed as readonly unknown[]).includes(v) ? v as T : d;
  const ticker = typeof r.ticker === 'string' && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(r.ticker) ? r.ticker : null;
  return {
    ticker,
    side: pick(r.side, ['all', 'call', 'put'] as const, DEFAULT_FILTERS.side),
    day: pick(r.day, ['bugun', 'dun', 'uc'] as const, DEFAULT_FILTERS.day),
    minPrem: pick(r.minPrem, MIN_PREM_OPTIONS, DEFAULT_FILTERS.minPrem),
    expiry: pick(r.expiry, ['all', 'zero', 'weekly'] as const, DEFAULT_FILTERS.expiry),
  };
}

export type AkisView = 'liste' | 'dagilim';
/** Kalıcı Akış tercihleri (AsyncStorage: akis-filters-v1). Büyük AppState'e girmez. */
export interface AkisPrefs { filters: FlowFilters; view: AkisView; dagTicker: string | null }
export const DEFAULT_PREFS: AkisPrefs = { filters: DEFAULT_FILTERS, view: 'liste', dagTicker: null };

const validTicker = (v: unknown): string | null => typeof v === 'string' && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(v) ? v : null;

/** Depodan okunan ham değeri doğrular; her alan geçersizse varsayılana düşer. */
export function validPrefs(raw: unknown): AkisPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    filters: validFilters(r.filters),
    view: r.view === 'dagilim' ? 'dagilim' : 'liste',
    dagTicker: validTicker(r.dagTicker),
  };
}
