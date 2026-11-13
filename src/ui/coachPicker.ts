/*
 * Ekran görüntüsü seçici (expo-image-picker, SDK 58 ile Expo Go'da gelir; OTA ile dağıtılır).
 * İzin → çoklu seçim (en çok 40) → JPEG base64 (quality 0.7) → 4 MB ve sihirli bayt denetimi (src/lib/coach/image.ts).
 * Yükleme sıralı kuyrukla yapılır (src/lib/coach/queue.ts); seçim bellekte base64 tutar (40 görüntü ≈ 10–30 MB; quality 0.7).
 * Native modül yoksa (eski binary / dev build eksik) import hata verir: yakalanır, Türkçe mesaj döner, uygulama çökmez.
 */
import { checkImage } from '@/lib/coach/image';

export const PICKER_MISSING = 'Görsel seçici bu sürümde yok (expo-image-picker gerekir; Expo Go güncel değilse yenileyin).';
export const MAX_PICK = 40;   // tek seçimde en çok 40 görüntü (≈ 20 işlem × alış+satış)
const PICK_QUALITY = 0.7;

export interface PickedImage { base64: string; mime: 'image/jpeg' }
export type PickResult =
  | { ok: true; images: PickedImage[]; skipped: string[] }
  | { ok: false; kind: 'missing' | 'permission' | 'cancel' | 'empty' | 'error'; reason: string };

/** Modül yoksa null: native modül import anında hata verebilir */
async function loadPicker(): Promise<typeof import('expo-image-picker') | null> {
  try {
    return await import('expo-image-picker');
  } catch {
    return null;
  }
}

export async function pickScreenshots(): Promise<PickResult> {
  const ImagePicker = await loadPicker();
  if (!ImagePicker) return { ok: false, kind: 'missing', reason: PICKER_MISSING };
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, kind: 'permission', reason: 'Fotoğraf kitaplığı izni verilmedi (Ayarlar › Expo Go › Fotoğraflar).' };
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PICK,
      base64: true,
      quality: PICK_QUALITY,
    });
    if (res.canceled || !res.assets?.length) return { ok: false, kind: 'cancel', reason: 'Seçim iptal edildi.' };

    const images: PickedImage[] = [];
    const skipped: string[] = [];
    res.assets.forEach((a, i) => {
      const n = `${i + 1}. görüntü`;
      // expo-image-picker: base64 alanı her zaman JPEG verisidir
      if (!a.base64) { skipped.push(`${n}: veri alınamadı`); return; }
      const chk = checkImage('image/jpeg', a.base64);
      if (!chk.ok) { skipped.push(`${n}: ${chk.error}`); return; }
      images.push({ base64: a.base64, mime: 'image/jpeg' });
    });
    if (!images.length) return { ok: false, kind: 'empty', reason: skipped.join(' · ') || 'Uygun görüntü yok.' };
    return { ok: true, images, skipped };
  } catch (e) {
    return { ok: false, kind: 'error', reason: `Görsel seçici çalışmadı: ${(e as Error).message || 'bilinmeyen hata'}` };
  }
}
