/* Uygulama istemcisi: Akış listesi ve push kaydı (sunucu API'si). Saf fetch; anahtar yalnız başlıkta gider, loglanmaz. */
import { FLOW_BASE_URL, type FlowEvent, type FlowSummaryRow } from './model.ts';
import { APP_KEY_HEADER, flowEventsUrl, isExpoPushToken } from './proxy.ts';
import { getJSON } from '../market/types.ts';

export interface FlowFeed { events: FlowEvent[]; serverTime: number; creditsToday: number | null; polling: boolean; days: number | null; fromDay: string | null }

/** EAS/derleme zamanı anahtarı (isteğe bağlı; tercih edilen yol uygulama içi ayar). Expo bunu derleme sırasında gömer. */
/** Uygulama içi anahtar yoksa derleme zamanı anahtarı */
export const flowKeyOf = (stored?: string | null): string => (stored ?? '').trim();   // anahtar yalnız cihazda (Hesapla › Ayarlar); paket içine gömülmez

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

function authErr(e: unknown, status?: number): Error {
  const s = status ?? (e as { status?: number })?.status;
  if (s === 401 || s === 403) return new Error('Akış anahtarı geçersiz');
  if (s === 429) return new Error('Sunucu istek sınırında — biraz sonra dene');
  if (e instanceof Error && /Zaman aşımı|Bağlantı yok/.test(e.message)) return e;
  return new Error(s ? `Sunucu hatası (${s})` : 'Bağlantı yok');
}
