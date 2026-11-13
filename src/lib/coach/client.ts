/*
 * Koç uygulama istemcisi (saf fetch; ağ). Anahtar yalnız x-app-key başlığında gider, loglanmaz.
 * Sunucu: POST /coach, GET /coach?day=, POST /coach/karne?day=  (server/README.md "Koç").
 */
import { FLOW_BASE_URL } from '../flow/model.ts';
import { APP_KEY_HEADER } from '../flow/proxy.ts';
import type { ExtractedTrade, Karne, RuleFact, TradeFeedback } from './types.ts';

/** Günün görünümündeki tek işlem (sunucu GET /coach) */
export interface CoachViewTrade { id: number; ts: number; trade: ExtractedTrade; rules: RuleFact[]; feedback: TradeFeedback | null; model: string }

export interface CoachDayView {
  day: string;
  trades: CoachViewTrade[];
  karne: { day: string; ts: number; model: string; body: Karne } | null;
  usage: { calls: number; inTok: number; outTok: number };
}
export interface CoachResult {
  day: string; model: string; fallback: boolean; okuNamadi: string | null; warning: string | null;
  usage: { inTok: number; outTok: number };
  trades: (CoachViewTrade & { noData: string[] })[];
}

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
    if (r.status === 401) throw new Error('Akış anahtarı yanlış (Hesapla › Ayarlar)');
    if (!r.ok) throw new Error(typeof j?.error === 'string' ? j.error : `Sunucu hatası (HTTP ${r.status})`);
    return j as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Zaman aşımı — tekrar dene');
    if (e instanceof TypeError) throw new Error('Sunucuya ulaşılamadı (ağ)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchCoachDay(key: string, day: string, b?: string): Promise<CoachDayView> {
  if (!key) return Promise.reject(new Error('Akış anahtarı girilmedi (Hesapla › Ayarlar)'));
  return call<CoachDayView>(`${base(b)}/coach?day=${encodeURIComponent(day)}`, { headers: hdr(key) });
}

/** Ekran görüntüsünü gönderir (base64, PNG/JPEG). Uzun sürebilir: iki Haiku çağrısı. */
export function uploadScreenshot(key: string, img: { base64: string; mime: 'image/png' | 'image/jpeg'; day: string }, b?: string): Promise<CoachResult> {
  if (!key) return Promise.reject(new Error('Akış anahtarı girilmedi (Hesapla › Ayarlar)'));
  return call<CoachResult>(`${base(b)}/coach`, { method: 'POST', headers: hdr(key, true), body: JSON.stringify(img), timeoutMs: 120000 });
}

export function makeKarne(key: string, day: string, b?: string): Promise<{ day: string; model: string; karne: Karne; ts: number }> {
  if (!key) return Promise.reject(new Error('Akış anahtarı girilmedi (Hesapla › Ayarlar)'));
  return call(`${base(b)}/coach/karne?day=${encodeURIComponent(day)}`, { method: 'POST', headers: hdr(key), timeoutMs: 90000 });
}
