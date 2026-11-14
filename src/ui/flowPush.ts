/*
 * Akış push kaydı: izin (mevcut Türkçe akış, notify.ensurePermission) → Expo push tokenı → sunucuya kayıt.
 * Oturum başına bir kez dener (aynı anahtarla tekrar kayıt yok). Hata = Türkçe mesaj; asla fırlatmaz.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushToken } from '@/lib/flow/client';
import { ensurePermission } from '@/ui/notify';

let done: { key: string; msg: string } | null = null;

export async function registerFlowPush(key: string): Promise<string> {
  if (!key) return 'Akış anahtarı yok — bildirim kaydı yapılmadı';
  if (Platform.OS === 'web') return 'Web’de uzak bildirim yok';
  if (done?.key === key) return done.msg;
  try {
    if (!(await ensurePermission())) return 'Bildirim izni verilmedi (Ayarlar › Bildirimler)';
    const projectId: string | undefined = (Constants.expoConfig as any)?.extra?.eas?.projectId;
    const tok = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken(key, tok.data);
    done = { key, msg: 'Olağandışı akış bildirimleri açık' };
    return done.msg;
  } catch (e) {
    // Başarısızsa önbellek yok: sonraki yenilemede yeniden denenir. Expo Go'da uzak push kısıtlı olabilir.
    return `Uzak bildirim kaydı olmadı: ${(e as Error)?.message ?? 'bilinmeyen hata'}`;
  }
}

/** Expo push tokenı (izin yoksa / web'de / hata → null; asla fırlatmaz). Bilanço favorisi bildirimi için. */
export async function currentPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    if (!(await ensurePermission())) return null;
    const projectId: string | undefined = (Constants.expoConfig as any)?.extra?.eas?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    return null;
  }
}
