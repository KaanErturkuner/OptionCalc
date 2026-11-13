/*
 * Veri tazelik göstergesi — saf mantık (React/AsyncStorage YOK; testler Node'da çalışır).
 * Fetch noktaları reportOk/reportFail ile bildirir; UI (src/ui/freshnessStore.ts) bu kayıt defterine abone olur.
 * Bildirim çağrıları asla fırlatmaz.
 */
import { isSessionOpenNow } from './usmarket.ts';

export type Source = 'md-options' | 'quotes' | 'news';
export const SOURCES: Source[] = ['md-options', 'quotes', 'news'];
export const SOURCE_LABEL: Record<Source, string> = {
  'md-options': 'MarketData opsiyon / quote',
  quotes: 'Hisse fiyatı / 1 dk bar',
  news: 'Haber (Radar)',
};

export type Status = 'kapali' | 'hata' | 'guncel' | 'gecikmeli' | 'kullanilmiyor';
export const STATUS_LABEL: Record<Status, string> = {
  kapali: 'Piyasa kapalı', hata: 'Veri yok / hata', guncel: 'Güncel', gecikmeli: 'Gecikmeli', kullanilmiyor: 'Kullanılmıyor',
};
export const MD_DELAY_MS = 15 * 60000;   // MarketData hisse verisi planda ~15 dk gecikmeli
export const MIN_TOL_MS = 2 * 60000;     // fiyat kaynakları için en az tolerans
export const NEWS_TOL_MS = 15 * 60000;   // haber için geniş tolerans
export const DEFAULT_INTERVAL_MS = 60000;
const MAX_MSG = 160;

/** Kaynak kaydı (bellekte; kalıcılık gerekmez) */
export interface SourceRec {
  okAt: number | null; provider: string | null;
  errAt: number | null; err: string | null; errProvider: string | null;
  /** Sahip (ekran) → beklenen tarama aralığı (ms). Etkin aralık = en kısası. */
  owners: Record<string, number>; nextAt: number | null;
}
export const emptyRec = (): SourceRec => ({ okAt: null, provider: null, errAt: null, err: null, errProvider: null, owners: {}, nextAt: null });
/** Etkin beklenen aralık: aktif sahiplerin en kısası; yoksa null (varsayılan kullanılır) */
export function effectiveInterval(owners: Record<string, number>): number | null {
  const v = Object.values(owners).filter(x => x > 0);
  return v.length ? Math.min(...v) : null;
}

/** Durum değerlendirmesi (UI'nin ihtiyaç duyduğu tüm alanlar) */
export interface Assessment {
  source: Source; label: string; status: Status; statusLabel: string;
  provider: string | null; okAt: number | null; errAt: number | null; err: string | null;
  nextAt: number | null; intervalMs: number; delayNote: boolean; closedNote: boolean;
}

// ───────── Gizli değerler ve mesaj temizleme ─────────
const secrets = new Set<string>();
/** Kayıt edilen tokenlar mesajlarda maskelenir (kısa/boş değerler yok sayılır) */
export function registerSecret(v: unknown): void {
  try { if (typeof v === 'string' && v.trim().length >= 6) secrets.add(v.trim()); } catch { /* yok say */ }
}
function envSecrets(): string[] {
  try {
    const env: Record<string, string | undefined> = typeof process !== 'undefined' && process?.env ? process.env : {};
    return Object.entries(env).filter(([k, v]) => /TOKEN|KEY|SECRET|PASS/i.test(k) && typeof v === 'string' && v.length >= 8).map(([, v]) => v as string);
  } catch { return []; }
}
const rawText = (e: unknown): string => {
  try {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
    return String(e);
  } catch { return 'Bilinmeyen hata'; }
};

/**
 * Hata metnini güvenli hâle getirir: URL query'si atılır, Authorization/Bearer ve token=/apikey= değerleri
 * maskelenir, kayıtlı + ortam tokenları maskelenir, uzun token benzeri dizgiler maskelenir, ≤ 160 karakter.
 */
export function sanitizeMsg(e: unknown, extra: string[] = []): string {
  let s = rawText(e);
  s = s.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#'"<>)\]]+)\?[^\s'"<>)\]]*/gi, '$1');       // URL query at
  s = s.replace(/(authorization["']?\s*[:=]\s*)[^\r\n]+/gi, '$1***');                    // Authorization başlığı
  s = s.replace(/\bbearer\s+[^\s,;'"]+/gi, 'Bearer ***');
  s = s.replace(/\b(access_token|api[_-]?key|apikey|token|secret|password|passwd|crumb)(["']?\s*[=:]\s*["']?)[^\s&,;'")]+/gi, '$1$2***');
  for (const v of [...secrets, ...envSecrets(), ...extra]) if (v) s = s.split(v).join('***');
  s = s.replace(/[A-Za-z0-9_\-]{32,}/g, '***');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = 'Bilinmeyen hata';
  return s.length > MAX_MSG ? s.slice(0, MAX_MSG - 1) + '…' : s;
}

// ───────── Saf durum mantığı ─────────
const used = (r: SourceRec | undefined): r is SourceRec => !!r && (r.okAt != null || r.errAt != null);

/**
 * Bir kaynağın durumu. Öncelik: kullanılmıyor → seans kapalı → kapalı → son deneme hata → hata
 * → yaşa göre güncel / gecikmeli. MarketData hisse verisi (quotes + provider marketdata) 15 dk ek tolerans alır ve
 * sarı/kırmızı yalnız hatadan kaynaklanır ya da 15 dk tolerans da aşılırsa gecikmeli olur.
 */
export function assess(source: Source, rec: SourceRec | undefined, now: number, sessionOpen: boolean): Assessment {
  const r = rec ?? emptyRec();
  const interval = effectiveInterval(r.owners) ?? DEFAULT_INTERVAL_MS;
  const base = { source, label: SOURCE_LABEL[source], provider: r.provider, okAt: r.okAt, errAt: r.errAt, err: r.err ? sanitizeMsg(r.err) : null,
    nextAt: r.nextAt, intervalMs: interval, delayNote: false, closedNote: false };
  const mk = (status: Status, extra: Partial<Assessment> = {}): Assessment => ({ ...base, status, statusLabel: STATUS_LABEL[status], ...extra });
  if (!used(r)) return mk('kullanilmiyor');
  const fail = r.errAt != null && (r.okAt == null || r.errAt > r.okAt);
  // Tüm taramalar seansa bağlı (Radar haberleri de yalnız seans içinde çekilir) → seans dışı gri
  if (!sessionOpen) return mk('kapali', { closedNote: true });
  if (fail || r.okAt == null) return mk('hata');
  const mdQuote = source === 'quotes' && r.provider === 'marketdata';
  const tol = Math.max(2 * interval, source === 'news' ? NEWS_TOL_MS : MIN_TOL_MS);
  const limit = interval + tol + (mdQuote ? MD_DELAY_MS : 0);
  const age = now - r.okAt;
  const delayNote = mdQuote;
  if (age <= limit) return mk('guncel', { delayNote });
  return mk('gecikmeli', { delayNote });
}

const RANK: Record<Status, number> = { kullanilmiyor: -1, kapali: 0, guncel: 1, gecikmeli: 2, hata: 3 };
/**
 * Genel durum = kaynakların en kötüsü (hata > gecikmeli > güncel). Kullanılmayanlar dışlanır.
 * Kapalı kaynaklar yalnız hepsi kapalıysa belirleyici olur. Hiç kullanılan kaynak yoksa 'kullanilmiyor'.
 */
export function overall(list: Assessment[]): Status {
  const live = list.filter(a => a.status !== 'kullanilmiyor');
  if (!live.length) return 'kullanilmiyor';
  const open = live.filter(a => a.status !== 'kapali');
  if (!open.length) return 'kapali';
  return open.reduce<Status>((w, a) => RANK[a.status] > RANK[w] ? a.status : w, 'guncel');
}

/** Tüm kaynakların durumu (saat dilimi ve seans durumu dahil) */
export function assessAll(recs: Record<Source, SourceRec>, now: number): { list: Assessment[]; overall: Status; sessionOpen: boolean } {
  const sessionOpen = isSessionOpenNow(now);
  const list = SOURCES.map(s => assess(s, recs[s], now, sessionOpen));
  return { list, overall: overall(list), sessionOpen };
}

// ───────── Kayıt defteri (modül durumu) ─────────
let recs: Record<Source, SourceRec> = { 'md-options': emptyRec(), quotes: emptyRec(), news: emptyRec() };
type Listener = () => void;
const listeners = new Set<Listener>();
let pending = false;
function notify() {
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; listeners.forEach(f => { try { f(); } catch { /* dinleyici hatası yutulur */ } }); }, 0);
}
export function subscribe(f: Listener): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export function snapshot(): Record<Source, SourceRec> { return recs; }
const isSource = (s: unknown): s is Source => SOURCES.includes(s as Source);

/** Başarılı çağrı. provider: sağlayıcı kimliği (ör. 'marketdata', 'yahoo'). */
export function reportOk(source: Source, o: { provider?: string; at?: number } = {}): void {
  try {
    if (!isSource(source)) return;
    const at = Number.isFinite(o.at) ? (o.at as number) : Date.now();
    recs = { ...recs, [source]: { ...recs[source], okAt: at, provider: o.provider ?? recs[source].provider } };
    notify();
  } catch { /* asla fırlatma */ }
}
/** Başarısız çağrı. Hata metni burada temizlenir; ham metin saklanmaz. */
export function reportFail(source: Source, err: unknown, o: { provider?: string; at?: number } = {}): void {
  try {
    if (!isSource(source)) return;
    const at = Number.isFinite(o.at) ? (o.at as number) : Date.now();
    recs = { ...recs, [source]: { ...recs[source], errAt: at, err: sanitizeMsg(err), errProvider: o.provider ?? null } };
    notify();
  } catch { /* asla fırlatma */ }
}
/**
 * Beklenen tarama aralığı (ms) — sahip başına (ör. 'odte', 'firsat', 'radar'). intervalMs null/0 → sahip kaldırılır
 * (tarama kapalı). Etkin aralık en kısa aktif sahibin aralığıdır; tolerans bundan türetilir.
 */
export function setExpected(source: Source, intervalMs: number | null, owner = 'genel'): void {
  try {
    if (!isSource(source)) return;
    const cur = recs[source].owners;
    const want = intervalMs && intervalMs > 0 ? intervalMs : null;
    if ((want == null && !(owner in cur)) || (want != null && cur[owner] === want)) return;
    const owners = { ...cur };
    if (want == null) delete owners[owner]; else owners[owner] = want;
    recs = { ...recs, [source]: { ...recs[source], owners } };
    notify();
  } catch { /* asla fırlatma */ }
}
/** Bir sonraki yenileme zamanı (ms) — yalnız gösterim */
export function nextRefresh(source: Source, at: number | null): void {
  try {
    if (!isSource(source)) return;
    if (recs[source].nextAt === at) return;
    recs = { ...recs, [source]: { ...recs[source], nextAt: at } };
    notify();
  } catch { /* asla fırlatma */ }
}
/** Yalnız test: kaydı sıfırla */
export function resetForTests(): void { recs = { 'md-options': emptyRec(), quotes: emptyRec(), news: emptyRec() }; }

// ───── Biçimlendirme (saf; Türkçe) ─────
export const PROVIDER_NAME: Record<string, string> = {
  marketdata: 'MarketData', yahoo: 'Yahoo', cboe: 'CBOE', tradier: 'Tradier', sec: 'SEC', finnhub: 'Finnhub',
};
export const providerName = (p: string | null | undefined) => (p ? PROVIDER_NAME[p] ?? p : '—');
/** İstanbul saati (UTC+3, yaz saati yok): HH:MM:SS */
export function istHms(ms: number): string {
  const d = new Date(ms + 3 * 3600000), p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
/** "x dk önce" / "x sn önce" (gelecekteyse "az önce") */
export function agoText(ms: number, now: number): string {
  const d = Math.max(0, now - ms);
  if (d < 60000) return `${Math.floor(d / 1000)} sn önce`;
  if (d < 3600000) return `${Math.floor(d / 60000)} dk önce`;
  return `${Math.floor(d / 3600000)} sa ${Math.floor((d % 3600000) / 60000)} dk önce`;
}
/** "HH:MM:SS (x dk önce)" */
export const stamp = (ms: number | null, now: number): string => ms == null ? '—' : `${istHms(ms)} (${agoText(ms, now)})`;
/** Kısa durum metni (hap) */
export const SHORT_LABEL: Record<Status, string> = {
  kapali: 'Piyasa kapalı', hata: 'Veri yok / hata', guncel: 'Güncel', gecikmeli: 'Gecikmeli', kullanilmiyor: 'Kullanılmıyor',
};
