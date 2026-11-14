/*
 * Bilanço favorileri: cihazda kalıcı (AsyncStorage) ve sunucuya senkron (POST /earnings/favs, cihaz tokenı ile).
 * Sunucu, favori bir hissenin EPS'i açıklanınca bu cihaza bildirim gönderir (uygulama kapalıyken de). İzin yoksa yalnız yerel favori.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanSymbol, EARN_MAX_FAVS, normalizeSymbols } from '@/lib/earnings/model';
import { syncEarnFavs } from '@/lib/earnings/client';
import { flowKeyOf } from '@/lib/flow/client';
import { loadState } from '@/lib/state';
import { currentPushToken } from '@/ui/flowPush';

const KEY = 'earn-favs-v1';
let favs: string[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(favs)).catch(() => {}); };
let loading: Promise<void> | null = null;

async function doLoad() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) favs = normalizeSymbols(JSON.parse(raw), EARN_MAX_FAVS);
  } catch { /* boş */ }
  loaded = true;
  subs.forEach(f => f());
}
const ensure = (): Promise<void> => { if (!loading) loading = doLoad(); return loading; };

/** Sunucuya gönder (token + anahtar yoksa sessizce atlanır; bildirim izni yoksa yerel favori yeterli). */
export async function syncEarnFavsToServer(): Promise<'ok' | 'no-token' | 'no-key' | 'error' | 'no-favs'> {
  try {
    const st = await loadState();
    const key = flowKeyOf(st?.flowKey);
    if (!key) return 'no-key';
    const tok = await currentPushToken();
    if (!tok) return 'no-token';
    await syncEarnFavs(key, tok, favs);
    return 'ok';
  } catch {
    return 'error';
  }
}

export const earnFavs = {
  get: (): string[] => favs,
  has: (sym: string) => favs.includes(sym),
  /** Yıldız: ekle/çıkar. Sunucuya senkron arka planda. Dönen: yeni durum (favori mi). */
  toggle(sym: string): boolean {
    const s = cleanSymbol(sym);
    if (!s) return false;
    const on = !favs.includes(s);
    favs = on ? [...favs, s].slice(0, EARN_MAX_FAVS) : favs.filter(x => x !== s);
    emit();
    void syncEarnFavsToServer();
    return on;
  },
  load: () => ensure(),
  /** Ekran açılışında: yerel favorileri sunucuya bir kez bildir (token değişmiş olabilir) */
  syncNow: () => (favs.length ? syncEarnFavsToServer() : Promise.resolve('no-favs' as const)),
};

const subscribe = (f: () => void) => { subs.add(f); void ensure(); return () => { subs.delete(f); }; };
export function useEarnFavs(): string[] { return useSyncExternalStore(subscribe, () => favs, () => favs); }
