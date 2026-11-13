/* Uygulama istemcisi: rapor listesi ve tek rapor (sunucu API'si). Anahtar yalnız başlıkta gider; loglanmaz. */
import { FLOW_BASE_URL } from '../flow/model.ts';
import { APP_KEY_HEADER } from '../flow/proxy.ts';
import { getJSON } from '../market/types.ts';

export interface ReportItem { id: number; kind: string; day: string; ts: number; title: string; body: string; example?: boolean }

const hdr = (key: string) => ({ [APP_KEY_HEADER]: key, Accept: 'application/json' });
function errText(e: unknown): Error {
  const s = (e as { status?: number })?.status;
  if (s === 401 || s === 403) return new Error('Akış anahtarı geçersiz');
  if (s === 404) return new Error('Rapor bulunamadı');
  if (s === 429) return new Error('Sunucu istek sınırında — biraz sonra dene');
  if (e instanceof Error && /Zaman aşımı|Bağlantı yok/.test(e.message)) return e;
  return new Error(s ? `Sunucu hatası (${s})` : 'Bağlantı yok');
}

/** Son raporlar, yeni → eski, tam metinle */
export async function fetchReports(key: string, limit = 50, base = FLOW_BASE_URL): Promise<ReportItem[]> {
  if (!key) throw new Error('Akış anahtarı girilmedi (Hesapla › Ayarlar)');
  const j = await getJSON(`${base.replace(/\/+$/, '')}/reports?limit=${Math.min(50, Math.max(1, limit))}`, { headers: hdr(key), timeoutMs: 15000 })
    .catch(e => { throw errText(e); });
  return Array.isArray(j?.reports) ? j.reports : [];
}
