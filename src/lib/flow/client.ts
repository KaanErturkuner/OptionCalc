/* Uygulama istemcisi: Akış listesi ve push kaydı (sunucu API'si). Saf fetch; anahtar yalnız başlıkta gider, loglanmaz. */
import { FLOW_BASE_URL, type FlowEvent, type FlowSummaryRow } from './model.ts';
import { APP_KEY_HEADER, flowEventsUrl, flowYorumUrl, isExpoPushToken } from './proxy.ts';
import { getJSON } from '../market/types.ts';

export interface FlowFeed { events: FlowEvent[]; serverTime: number; creditsToday: number | null; polling: boolean; days: number | null; fromDay: string | null }

/** EAS/derleme zamanı anahtarı (isteğe bağlı; tercih edilen yol uygulama içi ayar). Expo bunu derleme sırasında gömer. */
/** Uygulama içi anahtar yoksa derleme zamanı anahtarı */
export const ENV_FLOW_KEY = (process.env.EXPO_PUBLIC_FLOW_API_KEY ?? '').trim();   // paket içi varsayılan (Kaan kararı: elle girmesin)
export const flowKeyOf = (stored?: string | null): string => (stored ?? '').trim() || ENV_FLOW_KEY;   // cihazdaki anahtar önce, yoksa paket içi

function hdr(key: string) { return { [APP_KEY_HEADER]: key, Accept: 'application/json' }; }

/** Son olayları çeker (yeni → eski). Hata: Türkçe mesaj (anahtar yanlışsa 401 metni). */
export async function fetchFlow(key: string, opts: { limit?: number; sinceId?: number; days?: number; base?: string } = {}, signal?: AbortSignal): Promise<FlowFeed> {
  if (!key) throw new Error('Akış anahtarı girilmedi (Hesapla › Ayarlar)');
  const url = flowEventsUrl(opts.base ?? FLOW_BASE_URL, { limit: opts.limit ?? 100, sinceId: opts.sinceId, days: opts.days });
  const j = await getJSON(url, { headers: hdr(key), signal, timeoutMs: 15000 }).catch(e => { throw authErr(e); });
  return {
    events: Array.isArray(j?.events) ? j.events : [], serverTime: Number(j?.serverTime) || Date.now(), creditsToday: j?.creditsToday ?? null,
    polling: !!j?.polling, days: j?.days ?? null, fromDay: j?.fromDay ?? null,
  };
}
export async function fetchFlowSummary(key: string, base = FLOW_BASE_URL, signal?: AbortSignal): Promise<FlowSummaryRow[]> {
  const j = await getJSON(`${base.replace(/\/+$/, '')}/flow/summary`, { headers: hdr(key), signal, timeoutMs: 15000 }).catch(e => { throw authErr(e); });
  return Array.isArray(j?.rows) ? j.rows : [];
}
/** Expo push token kaydı. Geçersiz biçim ve ağ hatası ayrı Türkçe mesajlarla. */
export async function registerPushToken(key: string, token: string, base = FLOW_BASE_URL): Promise<void> {
  if (!key) throw new Error('Akış anahtarı girilmedi');
  if (!isExpoPushToken(token)) throw new Error('Geçersiz push tokenı');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`${base.replace(/\/+$/, '')}/push/register`, {
      method: 'POST', headers: { ...hdr(key), 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: ctl.signal,
    });
    if (!r.ok) throw authErr(new Error(`HTTP ${r.status}`), r.status);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Zaman aşımı');
    throw e instanceof Error && /Akış|anahtar|Sunucu|sınır/.test(e.message) ? e : new Error('Bağlantı yok');
  } finally { clearTimeout(t); }
}

/** Sunucunun AI yorumu (ticker + gün başına tek, en son metin). `stored`: kayıt daha önce üretilmişti. */
export interface FlowYorum { text: string; ticker: string; day: string; createdAt: number; model: string; stored?: boolean }
export const YORUM_TIMEOUT_MS = 90000;

/** GET: kayıtlı yorum; yoksa null (404). */
export async function fetchFlowYorum(key: string, ticker: string, day: string, base = FLOW_BASE_URL): Promise<FlowYorum | null> {
  return yorumReq('GET', key, ticker, day, base);
}
/** POST: yeni yorum üretir ve varsa eskisinin yerine yazar ("Yenile"). Haiku yavaş olabilir: 90 sn. */
export async function requestFlowYorum(key: string, ticker: string, day: string, base = FLOW_BASE_URL): Promise<FlowYorum> {
  const r = await yorumReq('POST', key, ticker, day, base);
  if (!r) throw new Error('Bu gün için akış yok.');
  return r;
}

async function yorumReq(method: 'GET' | 'POST', key: string, ticker: string, day: string, base: string): Promise<FlowYorum | null> {
  if (!key) throw new Error('Akış anahtarı girilmedi (Hesapla › Ayarlar)');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), YORUM_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(flowYorumUrl(base, ticker, day), { method, headers: hdr(key), signal: ctl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('AI yorum zaman aşımına uğradı (90 sn). Tekrar dene.');
    throw new Error('Bağlantı yok');
  } finally { clearTimeout(t); }
  if (r.status === 404 && method === 'GET') return null;
  const j = await r.json().catch(() => null) as { error?: string; text?: string; ticker?: string; day?: string; createdAt?: number; model?: string; stored?: boolean } | null;
  if (!r.ok) throw yorumErr(r.status, j?.error);
  if (typeof j?.text !== 'string') throw new Error('Sunucu hatası (yanıt okunamadı)');
  return { text: j.text, ticker: j.ticker ?? ticker, day: j.day ?? day, createdAt: Number(j.createdAt) || 0, model: j.model ?? '', stored: j.stored };
}

/** Yorum uç noktası hata eşlemesi. Sunucu Türkçe `error` alanı varsa onu gösterir (anahtar/gizli bilgi içermez). */
function yorumErr(status: number, serverMsg?: string): Error {
  if (status === 401 || status === 403) return new Error('Akış anahtarı geçersiz');
  if (status === 429) return new Error('Sunucu istek sınırında — biraz sonra dene');
  if (status === 504) return new Error('AI yorum zaman aşımına uğradı (sunucu). Tekrar dene.');
  if (serverMsg) return new Error(serverMsg);
  if (status === 404) return new Error('Bu gün için akış yok.');
  if (status === 400) return new Error('Geçersiz hisse ya da gün');
  if (status === 503) return new Error('AI yorum yapılandırılmadı: sunucuda Anthropic anahtarı yok');
  return new Error(`Sunucu hatası (${status})`);
}

function authErr(e: unknown, status?: number): Error {
  const s = status ?? (e as { status?: number })?.status;
  if (s === 401 || s === 403) return new Error('Akış anahtarı geçersiz');
  if (s === 429) return new Error('Sunucu istek sınırında — biraz sonra dene');
  if (e instanceof Error && /Zaman aşımı|Bağlantı yok/.test(e.message)) return e;
  return new Error(s ? `Sunucu hatası (${s})` : 'Bağlantı yok');
}
