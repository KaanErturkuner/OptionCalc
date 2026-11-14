/*
 * Ekran görüntüsü seçici (expo-image-picker + expo-image-manipulator; ikisi de Expo Go SDK 58'de gelir).
 * İzin → çoklu seçim (en çok 40) → HER görüntü JPEG'e çevrilir (genişlik ≤1600, uzun kenar ≤2000, kalite 0,7; HEIC/PNG dâhil)
 * → base64. Çevirme başarısızsa seçicinin kendi base64'üne düşülür (yalnız gerçek JPEG ise). Her görüntü için neden kaydedilir.
 * Native modül yoksa import hata verir: yakalanır, Türkçe mesaj döner, uygulama çökmez.
 */
import { checkImage, scaleDims, sniffMime } from '@/lib/coach/image';

export const PICKER_MISSING = 'Görsel seçici bu sürümde yok (expo-image-picker gerekir; Expo Go güncel değilse yenileyin).';
export const MAX_PICK = 40;   // tek seçimde en çok 40 görüntü (≈ 20 işlem × alış+satış)
const PICK_QUALITY = 0.7;
const MAX_WIDTH = 1600, MAX_LONG = 2000;

export interface PickedImage { base64: string; mime: 'image/jpeg'; label: string; source: 'convert' | 'picker'; width: number | null; height: number | null }
export type PickResult =
  | { ok: true; images: PickedImage[]; skipped: string[] }
  | { ok: false; kind: 'missing' | 'permission' | 'cancel' | 'empty' | 'error'; reason: string };

type Picker = typeof import('expo-image-picker');
type ManipMod = typeof import('expo-image-manipulator');

/** Modüller yoksa null: native modül import anında hata verebilir (Metro: import() yolu sabit olmalı) */
async function loadPicker(): Promise<Picker | null> {
  try { return await import('expo-image-picker'); } catch { return null; }
}
async function loadManip(): Promise<ManipMod | null> {
  try { return await import('expo-image-manipulator'); } catch { return null; }
}

export async function pickScreenshots(onPrepare?: (done: number, n: number) => void): Promise<PickResult> {
  const ImagePicker = await loadPicker();
  if (!ImagePicker) return { ok: false, kind: 'missing', reason: PICKER_MISSING };
  const Manip = await loadManip();
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, kind: 'permission', reason: 'Fotoğraf kitaplığı izni verilmedi (Ayarlar › Expo Go › Fotoğraflar).' };
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PICK,
      base64: true,           // yalnız çevirme başarısızsa yedek; çevrilmiş görüntü kendi base64'ünü getirir
      quality: PICK_QUALITY,
    });
    if (res.canceled || !res.assets?.length) return { ok: false, kind: 'cancel', reason: 'Seçim iptal edildi.' };

    const images: PickedImage[] = [];
    const skipped: string[] = [];
    const n = res.assets.length;
    for (let i = 0; i < n; i++) {
      const a = res.assets[i];
      const label = `${i + 1}. görüntü`;
      onPrepare?.(i, n);
      const r = await convertOne(Manip, a.uri, a.width ?? null, a.height ?? null, a.base64 ?? null);
      if (r.ok) images.push({ base64: r.base64, mime: 'image/jpeg', label, source: r.source, width: r.width, height: r.height });
      else skipped.push(`${label}: ${r.error}`);
    }
    onPrepare?.(n, n);
    if (!images.length) return { ok: false, kind: 'empty', reason: skipped.join(' · ') || 'Uygun görüntü yok.' };
    return { ok: true, images, skipped };
  } catch (e) {
    return { ok: false, kind: 'error', reason: `Görsel seçici çalışmadı: ${(e as Error).message || 'bilinmeyen hata'}` };
  }
}

type ConvertOut = { ok: true; base64: string; source: 'convert' | 'picker'; width: number | null; height: number | null } | { ok: false; error: string };

/** Tek görüntü: JPEG'e çevir ve sınırla; çevirme olmazsa seçicinin base64'ü (JPEG ise) */
async function convertOne(Manip: ManipMod | null, uri: string, w: number | null, h: number | null, pickerB64: string | null): Promise<ConvertOut> {
  let convertErr = '';
  if (Manip) {
    try {
      const dims = w && h ? scaleDims(w, h, MAX_WIDTH, MAX_LONG) : null;
      // Yalnız genişlik verilir: en-boy oranını kütüphane korur (dönme/EXIF yönü ile çakışmaz)
      const resize = dims ? { width: dims.width } : { width: MAX_WIDTH };
      const out = await Manip.manipulateAsync(uri, [{ resize }], { compress: PICK_QUALITY, format: Manip.SaveFormat.JPEG, base64: true });
      if (!out.base64) throw new Error('çevirme sonucu boş');
      const chk = checkImage('image/jpeg', out.base64);
      if (!chk.ok) throw new Error(chk.error);
      return { ok: true, base64: out.base64, source: 'convert', width: out.width ?? null, height: out.height ?? null };
    } catch (e) {
      convertErr = (e as Error).message || 'çevirme hatası';
    }
  } else {
    convertErr = 'görüntü çevirici yok';
  }
  // Yedek: seçicinin base64'ü yalnız gerçek JPEG ise kullanılır (PNG/HEIC etiketli veri reddedilir)
  if (pickerB64 && sniffMime(pickerB64) === 'image/jpeg') {
    const chk = checkImage('image/jpeg', pickerB64);
    if (chk.ok) return { ok: true, base64: pickerB64, source: 'picker', width: w, height: h };
    return { ok: false, error: chk.error };
  }
  return { ok: false, error: `dönüştürülemedi (${convertErr}${pickerB64 ? `; seçici verisi ${sniffMime(pickerB64)}` : ''})` };
}
