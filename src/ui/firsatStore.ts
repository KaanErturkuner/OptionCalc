/* Fırsat deposu: sinyal tickerları, tarama durumu, bildirim kapısı kayıtları, sinyal kaydı. AsyncStorage anahtarı firsat-v1. */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_TICKERS } from '@/lib/signals/tickers';
import type { Sent } from '@/lib/signals/gate';
import type { SignalLog } from '@/lib/signals/log';

const KEY = 'firsat-v1';
export interface FirsatSettings { tickers: string[]; intervalMin: 1 | 2 | 5 }
export const DEF_FIRSAT: FirsatSettings = { tickers: DEFAULT_TICKERS, intervalMin: 2 };
export interface TickerStatus {
  at: number; spot: number; changePct: number; expiry: string; dte: number; emPct: number; expectedMove: number;
  k: number; kSource: string; kNote: string; vwapSide: 'üstünde' | 'altında' | '—'; frames: string; volRatio: number | null;
  source: string; delayedMin: number; warn: string | null; setups: string[]; error?: string;
}
export interface FirsatData { settings: FirsatSettings; status: Record<string, TickerStatus>; lastScan: number | null; sent: Sent[]; log: SignalLog[] }
const EMPTY: FirsatData = { settings: DEF_FIRSAT, status: {}, lastScan: null, sent: [], log: [] };
let data: FirsatData = EMPTY, loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); };
let loading: Promise<void> | null = null;
function ensure(): Promise<void> { if (!loading) loading = doLoad(); return loading; }
async function doLoad() {
  if (loaded) return; loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) { const j = JSON.parse(raw); data = { ...EMPTY, ...j, settings: { ...DEF_FIRSAT, ...(j.settings ?? {}) } }; }
  } catch { /* boş */ }
  subs.forEach(f => f());
}
export const firsat = {
  get: () => data,
  load: () => ensure(),
  setTickers(list: string[]) {
    const tickers = [...new Set(list)].slice(0, 8);
    const status = Object.fromEntries(Object.entries(data.status).filter(([t]) => tickers.includes(t)));
    data = { ...data, settings: { ...data.settings, tickers }, status }; emit();
  },
  setInterval(min: 1 | 2 | 5) { data = { ...data, settings: { ...data.settings, intervalMin: min } }; emit(); },
  setStatus(t: string, s: TickerStatus) { data = { ...data, status: { ...data.status, [t]: s } }; emit(); },
  setLastScan(at: number) { data = { ...data, lastScan: at }; emit(); },
  setSent(sent: Sent[]) { data = { ...data, sent }; emit(); },
  setLog(log: SignalLog[]) { data = { ...data, log }; emit(); },
};
export function useFirsat(): FirsatData { return useSyncExternalStore((f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); }; }, () => data, () => data); }
