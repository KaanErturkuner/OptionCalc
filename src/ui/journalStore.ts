/* Günlük + sinyal kayıtları için basit global depo (AsyncStorage + abonelik) */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SignalLog, Trade } from '@/lib/journal';

const KEY = 'journal-v1';
interface Data { trades: Trade[]; signals: SignalLog[] }
let data: Data = { trades: [], signals: [] }, loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); };
let loading: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!loading) loading = doLoad();
  return loading;
}
async function doLoad() {
  if (loaded) return;
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) { const j = JSON.parse(raw), seen = new Set([...data.trades, ...data.signals].map(x => x.id)); // yükleme öncesi eklenenleri koru
    data = { trades: [...data.trades, ...(j.trades || []).filter((x: Trade) => !seen.has(x.id))], signals: [...data.signals, ...(j.signals || []).filter((x: SignalLog) => !seen.has(x.id))] }; } } catch { /* boş */ }
  loaded = true;
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});   // yükleme bitti: birleşik veriyi kaydet
  subs.forEach(f => f());
}
export const journal = {
  get: () => data,
  /** Depodan yükle (arka plan görevinde UI aboneliği olmadan) */
  load: () => ensure(),
  addTrade(t: Trade) { data = { ...data, trades: [t, ...data.trades] }; emit(); },
  updateTrade(id: string, patch: Partial<Trade>) { data = { ...data, trades: data.trades.map(t => t.id === id ? { ...t, ...patch } : t) }; emit(); },
  removeTrade(id: string) { data = { ...data, trades: data.trades.filter(t => t.id !== id) }; emit(); },
  addSignal(s: SignalLog) {
    // aynı sembol + kontrat için 30 dk içinde tekrar kaydetme
    if (data.signals.some(x => x.ticker === s.ticker && x.strike === s.strike && x.dir === s.dir && s.time - x.time < 30 * 60000)) return false;
    data = { ...data, signals: [s, ...data.signals].slice(0, 500) }; emit(); return true;
  },
  updateSignal(id: string, patch: Partial<SignalLog>) { data = { ...data, signals: data.signals.map(x => x.id === id ? { ...x, ...patch } : x) }; emit(); },
  clearSignals() { data = { ...data, signals: [] }; emit(); },
};
const subscribe = (f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); }; };
export function useJournal(): Data { return useSyncExternalStore(subscribe, () => data, () => data); }
