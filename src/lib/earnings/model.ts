/*
 * Bilanço takvimi (saf, paylaşılan): sunucu ve uygulama aynı tipleri ve doğrulamayı kullanır.
 * Kaynak: Finnhub (sunucu proxy'si: GET /earnings, GET /earnings/history; favoriler POST /earnings/favs).
 * Ağ YOK burada. Sözleşme: { from, to, fetchedAt, items[] } — items yalnız [from,to] aralığında, tarih+sembol başına tek satır.
 */
import { addDaysStr, closeMs, etDate } from '../usmarket.ts';

export type EarnHour = 'bmo' | 'amc' | 'dmh' | '';
export interface EarningsItem {
  date: string; symbol: string; hour: EarnHour;
  epsEstimate: number | null; epsActual: number | null;
  revenueEstimate: number | null; revenueActual: number | null;
  surprisePct: number | null; quarter: number | null; year: number | null;
  marketCapUsd: number | null;            // sunucu önbelleği (profil); bilinmiyorsa null
}
export interface EarningsRange { from: string; to: string; fetchedAt: number; items: EarningsItem[] }

/** Geçmiş bilanço çeyreği (Finnhub /stock/earnings): beklenti ve gerçek EPS, sürpriz % (hesaplanmış) */
export interface EarnHistoryRow { period: string; year: number | null; quarter: number | null; epsEstimate: number | null; epsActual: number | null; surprisePct: number | null }
export interface EarnHistory { symbol: string; fetchedAt: number; items: EarnHistoryRow[] }

export const EARN_MAX_RANGE_DAYS = 31;
export const EARN_DEFAULT_SPAN_DAYS = 7;
/** Küçük şirket filtresi: bu değerin altındaki (veya bilinmeyen) piyasa değerli hisseler izleme listesi/favori değilse gizlenir */
export const MIN_MARKET_CAP_USD = 2e9;
export const EARN_MAX_FAVS = 100;
export const EARN_MAX_WATCH = 200;
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const HOURS: EarnHour[] = ['bmo', 'amc', 'dmh', ''];

export const isIsoDay = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Gün dizisi [from..to] (dâhil). Aralık geçerliyse. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

/**
 * İstek aralığını doğrular. Eksik from → bugün (ET); eksik to → from + 6 gün (7 gün). En çok 31 gün.
 * Döner: {from,to} veya {error} (Türkçe, kısa).
 */
export function checkRange(from: string | null | undefined, to: string | null | undefined, today: string):
  { from: string; to: string } | { error: string } {
  const f = from == null || from === '' ? today : from;
  if (!isIsoDay(f)) return { error: 'from=YYYY-MM-DD gerekli' };
  const t = to == null || to === '' ? addDaysStr(f, EARN_DEFAULT_SPAN_DAYS - 1) : to;
  if (!isIsoDay(t)) return { error: 'to=YYYY-MM-DD gerekli' };
  if (t < f) return { error: 'to, from’dan önce olamaz' };
  const span = Math.round((Date.parse(t + 'T00:00:00Z') - Date.parse(f + 'T00:00:00Z')) / DAY_MS) + 1;
  if (span > EARN_MAX_RANGE_DAYS) return { error: `aralık en çok ${EARN_MAX_RANGE_DAYS} gün olabilir` };
  return { from: f, to: t };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** Sembol doğrulama + büyük harf. Geçersizse null. */
export function cleanSymbol(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const u = s.trim().toUpperCase();
  return SYMBOL_RE.test(u) ? u : null;
}

/** Virgüllü sembol listesi (sorgu parametresi ya da JSON dizisi) → tekil, geçerli, en çok `max` sembol. */
export function normalizeSymbols(input: unknown, max = EARN_MAX_WATCH): string[] {
  const raw: unknown[] = typeof input === 'string' ? input.split(',') : Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const x of raw) {
    const s = cleanSymbol(x);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Sürpriz %: (gerçek − beklenti) / |beklenti| × 100. İkisi de varsa ve beklenti sıfır değilse; aksi halde null. 2 ondalık. */
export function surprisePct(est: number | null, act: number | null): number | null {
  if (est == null || act == null || est === 0) return null;
  return Math.round(((act - est) / Math.abs(est)) * 10000) / 100;
}

/**
 * Finnhub /calendar/earnings yanıtı → doğrulanmış satırlar.
 * Beklenen yapı: { earningsCalendar: [{ date, symbol, hour, epsEstimate, epsActual, revenueEstimate, revenueActual, quarter, year }] }
 * Geçersiz sembol / tarih / aralık dışı satır elenir; sayılar sonlu değilse null; bilinmeyen saat → ''.
 * marketCapUsd burada null'dır; sunucu önbelleğinden (profil) sonradan doldurulur.
 */
export function parseFinnhubCalendar(json: unknown, from: string, to: string): EarningsItem[] {
  const rows = (json as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, EarningsItem>();
  for (const r0 of rows) {
    const r = (r0 ?? {}) as Record<string, unknown>;
    const symbol = cleanSymbol(r.symbol);
    const date = typeof r.date === 'string' ? r.date : '';
    if (!symbol || !isIsoDay(date) || date < from || date > to) continue;
    const hourRaw = typeof r.hour === 'string' ? r.hour.trim().toLowerCase() : '';
    const hour: EarnHour = (HOURS as string[]).includes(hourRaw) ? hourRaw as EarnHour : '';
    const epsEstimate = num(r.epsEstimate), epsActual = num(r.epsActual);
    const key = date + '|' + symbol;
    if (seen.has(key)) continue;
    seen.set(key, {
      date, symbol, hour, epsEstimate, epsActual,
      revenueEstimate: num(r.revenueEstimate), revenueActual: num(r.revenueActual),
      surprisePct: surprisePct(epsEstimate, epsActual),
      quarter: int(r.quarter, 1, 4), year: int(r.year, 1900, 2200),
      marketCapUsd: null,
    });
  }
  return [...seen.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol.localeCompare(b.symbol));
}

/** Finnhub /stock/profile2 → piyasa değeri (USD). Finnhub değeri MİLYON USD verir. Yoksa / geçersizse null. */
export function capUsdFromProfile(json: unknown): number | null {
  const m = num((json as { marketCapitalization?: unknown })?.marketCapitalization);
  return m != null && m > 0 ? Math.round(m * 1e6) : null;
}

/**
 * Küçük şirket filtresi: izleme listesinde / favorilerdeyse her zaman geçer; değilse piyasa değeri ≥ MIN_MARKET_CAP_USD.
 * Bilinmeyen değer (null) gizlenir (izleme/favori değilse).
 */
export function passesCapFilter(item: Pick<EarningsItem, 'symbol' | 'marketCapUsd'>, watch: ReadonlySet<string>): boolean {
  if (watch.has(item.symbol)) return true;
  return item.marketCapUsd != null && item.marketCapUsd >= MIN_MARKET_CAP_USD;
}

/**
 * Yeni gelen gerçek EPS: önceki durumda satır vardı ve epsActual boştu; şimdi dolu.
 * prev: "tarih|sembol" → o andaki epsActual dolu muydu. Önceden hiç görülmemiş satırlar bildirim üretmez
 * (ilk çekimde geçmiş sonuçlar için bildirim gelmesin).
 */
export function newActualsOf(prev: ReadonlyMap<string, boolean>, items: EarningsItem[]): EarningsItem[] {
  return items.filter(it => it.epsActual != null && prev.get(it.date + '|' + it.symbol) === false);
}

/** Geçmiş çeyrek satırları (Finnhub /stock/earnings dizisi) → doğrulanmış, eskiden yeniye. */
export function parseFinnhubHistory(json: unknown, symbol: string): EarnHistory {
  const rows = Array.isArray(json) ? json : [];
  const out: EarnHistoryRow[] = [];
  for (const r0 of rows) {
    const r = (r0 ?? {}) as Record<string, unknown>;
    const period = typeof r.period === 'string' && isIsoDay(r.period) ? r.period : '';
    if (!period) continue;
    const epsEstimate = num(r.estimate), epsActual = num(r.actual);
    out.push({ period, year: int(r.year, 1900, 2200), quarter: int(r.quarter, 1, 4), epsEstimate, epsActual, surprisePct: surprisePct(epsEstimate, epsActual) });
  }
  out.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  return { symbol, fetchedAt: 0, items: out.slice(-24) };
}

/** Son ANA KONTROL NOKTASI (UTC ms): bugünün 08:00 / 16:30 ET ve dünün 16:30 ET'si içinden şimdiye en yakın geçmiş olan. Yoksa 0. */
export function lastCheckpoint(nowMs: number): number {
  const today = etDate(nowMs);
  const yest = addDaysStr(today, -1);
  const cps = [closeMs(today) + 30 * 60000, closeMs(today) - 8 * 3600000, closeMs(yest) + 30 * 60000];
  return cps.filter(c => c <= nowMs).reduce((a, b) => Math.max(a, b), 0);
}

/**
 * Yenileme politikası. Bir gün için gerekli:
 *  - hiç çekilmemişse,
 *  - son çekim 24 saatten eskiyse,
 *  - gün geçmiş/bugünse (date <= bugün ET) ve son çekim, son kontrol noktasından (16:30 ET ve ertesi sabah 08:00 ET) öncesiyse
 *    (kapanış sonrası sonuçlar — epsActual/revenueActual — dolsun diye).
 * fetched: gün → son çekim (UTC ms). Dönen: yenilenmesi gereken günler (yoksa boş).
 */
export function staleDays(fetched: Map<string, number>, from: string, to: string, nowMs: number): string[] {
  const today = etDate(nowMs);
  const dayAgo = nowMs - DAY_MS;
  const cp = lastCheckpoint(nowMs);
  const out: string[] = [];
  for (const d of daysBetween(from, to)) {
    const at = fetched.get(d);
    if (at == null) { out.push(d); continue; }
    const threshold = d <= today ? Math.max(dayAgo, cp) : dayAgo;
    if (at < threshold) out.push(d);
  }
  return out;
}

/** Saat kodu → piyasa öncesi/sonrası/belirtilmemiş. dmh (işlem saatleri içinde) belirtilmemiş sayılır. */
export type EarnTiming = 'pre' | 'post' | 'unknown';
export const timingOfHour = (h: EarnHour): EarnTiming => (h === 'bmo' ? 'pre' : h === 'amc' ? 'post' : 'unknown');
