/* Yerel bildirimler (expo-notifications). Expo Go'da yerel bildirimler çalışır; uzaktan (push) bildirim yok. */
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications/build/NotificationChannelManager.types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { alertText, exitText, MAX_SIGNALS_PER_DAY, signalKey, type AlertKind, type Live } from '@/lib/alerts';
import type { Trade } from '@/lib/journal';
import { etDate } from '@/lib/usmarket';

const SENT_KEY = 'notif-sent-v1', ASKED_KEY = 'notif-asked-v1';
const CH = 'signals';
let inited = false;

export function initNotifications() {
  if (inited || Platform.OS === 'web') return; inited = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(CH, { name: '0DTE sinyal ve pozisyon uyarıları', importance: AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250] }).catch(() => {});
    }
  } catch { /* bildirim modülü yok */ }
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'web') return 'denied';
  try { const p = await Notifications.getPermissionsAsync(); return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied'; } catch { return 'denied'; }
}
const ask = () => new Promise<boolean>(res => Alert.alert(
  'Bildirimlere izin ver',
  '0DTE ekranı yeni bir fırsat (sinyal) bulduğunda, aldığın kontrat hedefe ya da stopa yaklaştığında/ulaştığında ve çıkış saati geldiğinde sana bildirim göndermek istiyorum. Bildirimler yalnızca bu telefonda oluşturulur.',
  [{ text: 'Şimdi değil', style: 'cancel', onPress: () => res(false) }, { text: 'İzin ver', onPress: () => res(true) }],
));
/** İzin yoksa önce Türkçe açıklama göster, sonra sistem iznini iste. force: daha önce sorulmuş olsa da sor. */
export async function ensurePermission(force = false): Promise<boolean> {
  const st = await permissionStatus();
  if (st === 'granted') return true;
  if (st === 'denied') {
    if (force) Alert.alert('Bildirim izni kapalı', 'Ayarlar › Expo Go › Bildirimler’den izin verebilirsin.');
    return false;
  }
  if (!force && await AsyncStorage.getItem(ASKED_KEY)) return false;
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
  if (!(await ask())) return false;
  try { const r = await Notifications.requestPermissionsAsync(); return r.granted; } catch { return false; }
}

async function show(title: string, body: string, data: Record<string, unknown> = {}) {
  if (Platform.OS === 'web') return null;
  if ((await permissionStatus()) !== 'granted') return null;
  try { return await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true }, trigger: Platform.OS === 'android' ? { channelId: CH } as any : null }); } catch { return null; }
}
async function at(when: number, title: string, body: string, data: Record<string, unknown> = {}) {
  if (Platform.OS === 'web' || when <= Date.now() + 5000) return null;
  if ((await permissionStatus()) !== 'granted') return null;
  try {
    return await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(when), ...(Platform.OS === 'android' ? { channelId: CH } : {}) } });
  } catch { return null; }
}

/** Yeni sinyal bildirimi — aynı sembol/yön/strike/vade için günde bir kez */
export async function notifySignal(sg: { ticker: string; dir: 'call' | 'put'; strike: number; expiry: string; time: number; dte: number; entry: number; target: number; stop: number; exitBy: string; rr: number }): Promise<boolean> {
  const key = signalKey(sg), today = etDate(Date.now());
  let sent: string[] = [];
  try { sent = JSON.parse((await AsyncStorage.getItem(SENT_KEY)) || '[]'); } catch { /* boş */ }
  if (sent.includes(key)) return false;
  // sembol başına günde en fazla 2 sinyal bildirimi
  if (sent.filter(x => x.startsWith(sg.ticker + '|') && x.endsWith('|' + etDate(sg.time))).length >= MAX_SIGNALS_PER_DAY) return false;
  const k = (sg.strike % 1 ? sg.strike.toFixed(1) : String(sg.strike)) + (sg.dir === 'call' ? 'C' : 'P');
  const id = await show(`⚡ [Test] ${sg.ticker} ${sg.dte === 0 ? '0DTE' : sg.dte + 'DTE'} ${k} AL`,
    `Giriş ≤ $${sg.entry.toFixed(2)} · kâr al $${sg.target.toFixed(2)} · stop $${sg.stop.toFixed(2)} · R/R ${sg.rr.toFixed(2)} · en geç ${sg.exitBy} çık · paper trading / test`,
    { kind: 'signal', ticker: sg.ticker });
  if (!id) return false;
  sent = [...sent.filter(x => x.endsWith('|' + today)), key].slice(-300);
  await AsyncStorage.setItem(SENT_KEY, JSON.stringify(sent)).catch(() => {});
  return true;
}
export async function notifyAlert(t: Trade, k: AlertKind, live: Live) {
  const m = alertText(t, k, live); return show(m.title, m.body, { kind: 'position', id: t.id, alert: k });
}
/** Çıkış saatinde ve 10 dk önce bildirim zamanla; kimlikleri döndür */
export async function scheduleExit(t: Trade): Promise<string[]> {
  if (!t.exitAt) return [];
  const ids: string[] = [];
  const a = exitText(t, 10), b = exitText(t, 0);
  const i1 = await at(t.exitAt - 10 * 60000, a.title, a.body, { kind: 'exit', id: t.id }); if (i1) ids.push(i1);
  const i2 = await at(t.exitAt, b.title, b.body, { kind: 'exit', id: t.id }); if (i2) ids.push(i2);
  return ids;
}
export async function cancelIds(ids?: string[]) {
  if (!ids?.length || Platform.OS === 'web') return;
  await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}
export async function testNotification() {
  if (!(await ensurePermission(true))) return false;
  return !!(await show('🔔 Test bildirimi', 'Bildirimler çalışıyor. 0DTE fırsatları ve pozisyon uyarıları böyle gelecek.'));
}

/** Radar uyarısı (yerel bildirim). Gövde ilk 180 karakterle sınırlanır; tam metin uygulamada. */
export async function notifyRadar(title: string, body: string, id: string) {
  const short = body.length > 180 ? body.slice(0, 177) + '…' : body;
  return show(title, short, { kind: 'radar', id });
}
