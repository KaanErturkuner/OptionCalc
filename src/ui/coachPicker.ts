/*
 * Ekran görüntüsü seçici. DURUM: expo-image-picker KURULU DEĞİL (native modül; OTA ile eklenemez, AGENTS.md: dev build).
 * Kurulunca yalnız bu dosyadaki pickScreenshot() doldurulur: izin → seçim → base64 + mime (image/png | image/jpeg).
 * Şimdilik: açık Türkçe neden döner; ekran geri kalan akışı (liste, geri bildirim, karne) çalışır.
 */
export type PickResult = { ok: true; base64: string; mime: 'image/png' | 'image/jpeg' } | { ok: false; reason: string };

export const PICKER_MISSING = 'Görsel seçici bu sürümde yok (expo-image-picker gerekir; dev build ile eklenecek). Geçmiş koçluk sonuçları yine görüntülenir.';

export async function pickScreenshot(): Promise<PickResult> {
  return { ok: false, reason: PICKER_MISSING };
}
