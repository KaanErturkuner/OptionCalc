/* Açık pozisyon takibi: canlı fiyat, hedef/stop uyarıları, arka plan görevi */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import * as J from '@/lib/journal';
import type { Trade } from '@/lib/journal';
import { checkLevels, type Live } from '@/lib/alerts';
import { loadState } from '@/lib/state';
import * as MD from '@/lib/market';
import { mid } from '@/lib/market/types';
import { marketOpen } from '@/lib/usmarket';
import { journal } from './journalStore';
import { notifyAlert } from './notify';
import { flowKeyOf } from '@/lib/flow/client';

export interface NotifCfg { signals: boolean; positions: boolean; background: boolean }
const CFG_KEY = 'notif-cfg-v1';
export const DEF_NOTIF: NotifCfg = { signals: true, positions: true, background: true };
export async function loadNotifCfg(): Promise<NotifCfg> {
  try { const r = await AsyncStorage.getItem(CFG_KEY); return r ? { ...DEF_NOTIF, ...JSON.parse(r) } : DEF_NOTIF; } catch { return DEF_NOTIF; }
}
export async function saveNotifCfg(c: NotifCfg) { await AsyncStorage.setItem(CFG_KEY, JSON.stringify(c)).catch(() => {}); }

/** Açık işlemler için canlı fiyat: opsiyon mid (zincirden) + dayanak */
export async function fetchLive(ts: Trade[]): Promise<Record<string, Live>> {
  const s0 = await loadState(); const keys = { marketdata: flowKeyOf(s0?.flowKey) || undefined, tradier: s0?.apiKey || undefined };
  const out: Record<string, Live> = {};
  for (const sym of [...new Set(ts.map(t => t.ticker))]) {
    try {
      const L = await MD.loadSymbol(sym, 'auto', keys);
      for (const t of ts.filter(x => x.ticker === sym)) {
        if (t.type === 'stock') { out[t.id] = { opt: L.quote.price, und: L.quote.price }; continue; }
        const ch = await MD.loadChain(L.provider, sym, t.expiry!, keys, 30).catch(() => null);
        const q = ch && (t.type === 'call' ? ch.calls : ch.puts).find(o => Math.abs(o.strike - (t.strike ?? 0)) < 1e-6);
        const m = q ? mid(q) : NaN;
        out[t.id] = { opt: isFinite(m) && m > 0 ? m : null, und: L.quote.price };
      }
    } catch { /* sembol atlanır */ }
  }
  return out;
}
/** Uyarı koşullarını kontrol et, yeni olanlar için bildirim gönder ve işaretle */
export async function checkAlerts(live: Record<string, Live>, only?: (t: Trade) => boolean): Promise<number> {
  const cfg = await loadNotifCfg(); if (!cfg.positions) return 0;
  let n = 0;
  for (const t of journal.get().trades) {
    if (!J.isOpen(t) || t.watch === false || (only && !only(t))) continue;
    const lv = live[t.id]; if (!lv) continue;
    for (const k of checkLevels(t, lv)) {
      await notifyAlert(t, k, lv); n++;
      journal.updateTrade(t.id, { alerts: [...(journal.get().trades.find(x => x.id === t.id)?.alerts || []), k] });
    }
  }
  return n;
}
/** Takip edilen açık pozisyonları kontrol et (canlı fiyat + uyarılar) */
export async function checkOpenPositions(): Promise<Record<string, Live>> {
  await journal.load();
  const ts = journal.get().trades.filter(t => J.isOpen(t) && t.watch !== false && (t.target != null || t.undTarget != null));
  if (!ts.length) return {};
  const live = await fetchLive(ts);
  await checkAlerts(live);
  return live;
}

// ——— Arka plan görevi (iOS BGTaskScheduler / Android WorkManager; zamanlamayı sistem belirler, en az ~15 dk) ———
export const BG_TASK = 'opsiyon-pozisyon-kontrol';
if (Platform.OS !== 'web') {
  try {
    TaskManager.defineTask(BG_TASK, async () => {
      try {
        const cfg = await loadNotifCfg();
        if (cfg.positions && cfg.background && marketOpen()) await checkOpenPositions();
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
    });
  } catch { /* görev tanımlanamadı */ }
}
/** Takip edilen açık pozisyon varsa arka plan görevini kaydet, yoksa kaldır. Durum metni döndürür. */
export async function syncBackgroundTask(): Promise<string> {
  if (Platform.OS === 'web') return 'Web’de yok';
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return 'Arka plan görevleri bu cihazda kısıtlı';
    await journal.load();
    const cfg = await loadNotifCfg();
    const want = cfg.background && cfg.positions && journal.get().trades.some(t => J.isOpen(t) && t.watch !== false && (t.target != null || t.undTarget != null));
    const reg = await TaskManager.isTaskRegisteredAsync(BG_TASK);
    if (want && !reg) await BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 15 });
    if (!want && reg) await BackgroundTask.unregisterTaskAsync(BG_TASK);
    return want ? 'Kayıtlı (sistem ~15 dk+ aralıkla çalıştırır, garanti değil)' : 'Takip edilen açık pozisyon yok';
  } catch (e) { return 'Kullanılamıyor: ' + ((e as Error)?.message || 'hata'); }
}
