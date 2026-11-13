/* Takip listesi deposu (AsyncStorage + abonelik). Saf kurallar src/lib/watchlist'te. */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addItems, type NewItem, type Snapshot, type WatchItem } from '@/lib/watchlist/model';

const KEY = 'watchlist-v1';
interface Data { items: WatchItem[] }
let data: Data = { items: [] }, loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); };
let loading: Promise<void> | null = null;
function ensure(): Promise<void> { if (!loading) loading = doLoad(); return loading; }
async function doLoad() {
  if (loaded) return; loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) { const j = JSON.parse(raw); if (Array.isArray(j?.items)) data = { items: [...j.items.filter((x: WatchItem) => x && x.id), ...data.items.filter(x => !j.items.some((y: WatchItem) => y?.id === x.id))] }; }
  } catch { /* boş */ }
  subs.forEach(f => f());
}
export const watch = {
  get: () => data,
  load: () => ensure(),
  /** Yeni kalemler ekler; sonuç: eklenen / yinelenen sayısı */
  add(news: NewItem[], now = Date.now()): { added: number; dup: number } {
    const r = addItems(data.items, news, now);
    data = { items: r.list };
    if (r.added) emit();
    return { added: r.added, dup: r.dup };
  },
  remove(id: string) { data = { items: data.items.filter(x => x.id !== id) }; emit(); },
  /** Yenileme sonucu: kalem id → yeni son bilinen fiyat (kalem silinmiş olabilir) */
  applyLast(updates: Record<string, Snapshot>) {
    const ids = Object.keys(updates); if (!ids.length) return;
    data = { items: data.items.map(x => updates[x.id] ? { ...x, last: updates[x.id] } : x) }; emit();
  },
};
const subscribe = (f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); }; };
export function useWatch(): Data { return useSyncExternalStore(subscribe, () => data, () => data); }
