/*
 * Koç uygulama istemcisi (fetch; ağ). Anahtar yalnız x-app-key başlığında gider, loglanmaz.
 * Sunucu: POST /coach (tek görüntü), GET /coach?day=, POST /coach/process?day=, POST /coach/karne?day=  (server/README.md "Koç").
 */
import { FLOW_BASE_URL } from '../flow/model.ts';
import { APP_KEY_HEADER } from '../flow/proxy.ts';
import type { CoachDayView, Karne } from './types.ts';

export type { CoachDayView, CoachFillView, CoachOpenView, CoachTradeView } from './types.ts';

/** HTTP hatası: status (ağ hatasında yok), 429 için kind ve retryAfterSec (sunucu). */
export class CoachHttpError extends Error {
  status?: number;
  kind?: 'gap' | 'daily';
  retryAfterSec?: number;
}

export interface UploadResult {
  day: string;
  duplicate: boolean;          // aynı görüntü daha önce işlendi (Haiku çağrısı yok, sayaç işlemedi)
  added: number;               // yeni eklenen dolum sayısı
  fills: { t: string; tk: string; exp: string; k: number; cp: 'C' | 'P'; q: number; side: 'buy' | 'sell'; px: number; conf: string }[];
  note: string | null;
  model: string;
  fallback: boolean;
  coached: number;             // bu istekte koçluk üretilen işlem sayısı
  pending: number;             // hâlâ koçluk bekleyen işlem sayısı
  warnings: string[];
  usage: { inTok: number; outTok: number };
}

export interface ProcessResult { processed: number; pending: number; errors: string[] }

const base = (b?: string) => (b ?? FLOW_BASE_URL).replace(/\/+$/, '');
const hdr = (key: string, json = false) => ({ [APP_KEY_HEADER]: key, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) });

/** Hata metnini Türkçe ve kısa tut; anahtar asla gösterilmez */
async function call<T>(url: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 30000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    let j: any = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* yapısal olmayan */ }
    if (r.status === 401) throw httpErr('Akış anahtarı yanlış (Hesapla › Ayarlar)', 401);
    if (!r.ok) {
      const hdrRetry = Number(r.headers.get('retry-after'));
      throw httpErr(typeof j?.error === 'string' ? j.error : `Sunucu hatası (HTTP ${r.status})`, r.status, {
        kind: j?.kind === 'daily' || j?.kind === 'gap' ? j.kind : undefined,
        retryAfterSec: Number(j?.retryAfterSec) || (Number.isFinite(hdrRetry) && hdrRetry > 0 ? hdrRetry : undefined),
      });
    }
    return j as T;
  } catch (e: any) {
    if (e instanceof CoachHttpError) throw e;
    if (e?.name === 'AbortError') throw httpErr('Zaman aşımı — tekrar dene');
    if (e instanceof TypeError) throw httpErr(`Sunucuya ulaşılamadı${e.message ? ` (${String(e.message).slice(0, 80)})` : ''}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function httpErr(message: string, status?: number, extra: { kind?: 'gap' | 'daily'; retryAfterSec?: number } = {}): CoachHttpError {
  const e = new CoachHttpError(message);
  e.status = status; e.kind = extra.kind; e.retryAfterSec = extra.retryAfterSec;
  return e;
}

const needKey = (key: string) => (key ? null : Promise.reject(httpErr('Akış anahtarı girilmedi (Hesapla › Ayarlar)')));

export function fetchCoachDay(key: string, day: string, b?: string): Promise<CoachDayView> {
  return needKey(key) ?? call<CoachDayView>(`${base(b)}/coach?day=${encodeURIComponent(day)}`, { headers: hdr(key) });
}

/** Tek ekran görüntüsü: sunucu çıkarır, eşleştirir, eşleşen yeni işlemler için koçluk üretir (en çok birkaç). */
export function uploadScreenshot(key: string, img: { base64: string; mime: 'image/png' | 'image/jpeg'; day: string }, b?: string): Promise<UploadResult> {
  return needKey(key) ?? call<UploadResult>(`${base(b)}/coach`, { method: 'POST', headers: hdr(key, true), body: JSON.stringify(img), timeoutMs: 150000 });
}

/** Bekleyen koçlukları işler (sunucu tek istekte birkaç işlem yapar; döngüyü istemci sürer). */
export function processCoach(key: string, day: string, b?: string): Promise<ProcessResult> {
  return needKey(key) ?? call<ProcessResult>(`${base(b)}/coach/process?day=${encodeURIComponent(day)}`, { method: 'POST', headers: hdr(key), timeoutMs: 150000 });
}

export function makeKarne(key: string, day: string, b?: string): Promise<{ day: string; model: string; karne: Karne; ts: number }> {
  return needKey(key) ?? call(`${base(b)}/coach/karne?day=${encodeURIComponent(day)}`, { method: 'POST', headers: hdr(key), timeoutMs: 90000 });
}
