/* Radar depo: uyarılar + isabet, günlük kayıtlar (taban çizgisi), OI / seans başı IV, ayarlar. AsyncStorage + abonelik. */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Alert } from '@/lib/radar/engine';
import type { DayRecord } from '@/lib/radar/types';
import { RADAR_WATCH } from '@/lib/radar/universe';

const KEY = 'radar-v1';
export interface RadarSettings { auto: boolean; secUa: string; finnhubKey: string; watch: string[] }
export const DEF_SETTINGS: RadarSettings = { auto: true, secUa: '', finnhubKey: '', watch: RADAR_WATCH };
export interface OiHist { prevDate: string | null; prevMap: Record<string, number> | null; latestDate: string | null; latestMap: Record<string, number> | null }
export interface Pulse { ticker: string; changePct: number; vwapSide: 'üstünde' | 'altında' | '—'; ivRank: number | null; mood: string }
export interface Data {
  alerts: Alert[]; days: Record<string, DayRecord[]>; oi: Record<string, OiHist>;
  ivOpen: Record<string, { date: string; iv: number }>; pulse: Pulse[]; lastScan: number | null; settings: RadarSettings;
}
const EMPTY: Data = { alerts: [], days: {}, oi: {}, ivOpen: {}, pulse: [], lastScan: null, settings: DEF_SETTINGS };
let data: Data = EMPTY, loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); };
let loading: Promise<void> | null = null;
function ensure(): Promise<void> { if (!loading) loading = doLoad(); return loading; }
async function doLoad() {
  if (loaded) return;
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) data = { ...EMPTY, ...JSON.parse(raw), settings: { ...DEF_SETTINGS, ...(JSON.parse(raw).settings ?? {}) } }; } catch { /* boş */ }
  loaded = true;
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});   // yükleme bitti: birleşik veriyi kaydet
  subs.forEach(f => f());
}
export const radar = {
  get: () => data,
  load: () => ensure(),
  /** Yeni uyarıları ekle (aynı id varsa atla); en fazla 300 tut */
  addAlerts(list: Alert[]) {
    const ids = new Set(data.alerts.map(a => a.id));
    const fresh = list.filter(a => !ids.has(a.id));
    if (!fresh.length) return;
    data = { ...data, alerts: [...fresh, ...data.alerts].slice(0, 300) }; emit();
  },
  patchOutcome(id: string, patch: Alert['outcome']) {
    data = { ...data, alerts: data.alerts.map(a => a.id === id ? { ...a, outcome: { ...a.outcome, ...patch } } : a) }; emit();
  },
  setFeedback(id: string, v: 1 | -1) {
    data = { ...data, alerts: data.alerts.map(a => a.id === id ? { ...a, feedback: a.feedback === v ? null : v } : a) }; emit();
  },
  /** Bugünkü gün kaydını yaz (aynı tarih ve ticker varsa değiştir); 260 gün tut */
  upsertDay(rec: DayRecord) {
    const cur = (data.days[rec.ticker] ?? []).filter(d => d.date !== rec.date);
    data = { ...data, days: { ...data.days, [rec.ticker]: [...cur, rec].slice(-260) } }; emit();
  },
  setOi(ticker: string, h: OiHist) { data = { ...data, oi: { ...data.oi, [ticker]: h } }; emit(); },
  setIvOpen(ticker: string, v: { date: string; iv: number }) { data = { ...data, ivOpen: { ...data.ivOpen, [ticker]: v } }; emit(); },
  setPulse(p: Pulse[], lastScan: number) { data = { ...data, pulse: p, lastScan }; emit(); },
  setSettings(p: Partial<RadarSettings>) { data = { ...data, settings: { ...data.settings, ...p } }; emit(); },
  clearAlerts() { data = { ...data, alerts: [] }; emit(); },
};
export function useRadar(): Data { return useSyncExternalStore((f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); }; }, () => data, () => data); }
