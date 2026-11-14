/* Fırsat deposu: ayarlar, tarama durumu, kâğıt hesap, onay kartları, bildirim kapısı, sinyal kaydı, hesap arşivi.
 * AsyncStorage anahtarı firsat-v1. Gerçek emir yok. */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_TICKERS } from '@/lib/signals/tickers';
import type { VerdictCard } from '@/lib/signals/verdict';
import { DEFAULT_Q, mergeQ, type QSettings } from '@/lib/signals/qull/policy';
import type { Sent } from '@/lib/signals/gate';
import type { SignalLog } from '@/lib/signals/log';
import type { Opp } from '@/lib/signals/opp';
import type { ApprovalState } from '@/lib/paper/approval';
import type { PaperAccount, Kademe } from '@/lib/paper/types';
import { initAccount, migrateSettings, FIRSAT_SCHEMA } from '@/lib/paper/account';

const KEY = 'firsat-v1';
export interface FirsatSettings {
  tickers: string[];
  intervalMin: 1 | 2 | 5;
  ttlMin: number | null;          // onay süresi ayarı (1–10 dk); null = 0DTE 3 dk, 1–3 DTE 5 dk
  q: QSettings;                   // Qullamaggie setupları (Qullamaggie uyarlaması — Kaan onayı yok)
}
export const DEF_FIRSAT: FirsatSettings = { tickers: DEFAULT_TICKERS, intervalMin: 2, ttlMin: null, q: DEFAULT_Q };

export interface TickerStatus {
  at: number; spot: number; changePct: number; expiry: string; dte: number; emPct: number; expectedMove: number;
  k: number; kSource: string; kNote: string; vwapSide: 'üstünde' | 'altında' | '—'; frames: string; volRatio: number | null;
  source: string; delayedMin: number; warn: string | null; setups: string[]; error?: string;
  verdict?: VerdictCard;
}

/** Onay kartı: aday + onay durumu. */
export interface Card extends Opp {
  id: string;
  state: ApprovalState;
  ask: number;
  ttlMs: number;
  freshAsk?: number; freshRr?: number; freshScore?: number; freshAt?: number;
  decidedAt?: number; note?: string;
}

/** Açık pozisyonun canlı durumu (son tur). */
export interface PosLive { bid: number; rMult: number; at: number; triggers: string[]; stop: number; adaptive?: string | null }

export interface Archived { at: number; account: PaperAccount }

export interface FirsatData {
  schema?: number;                // kayıt şema sürümü (account.ts FIRSAT_SCHEMA)
  settings: FirsatSettings;
  status: Record<string, TickerStatus>;
  lastScan: number | null;
  sent: Sent[];
  log: SignalLog[];
  paper: PaperAccount | null;
  cards: Card[];
  posLive: PosLive | null;
  archive: Archived[];
}
const EMPTY: FirsatData = { schema: FIRSAT_SCHEMA, settings: DEF_FIRSAT, status: {}, lastScan: null, sent: [], log: [], paper: null, cards: [], posLive: null, archive: [] };
let data: FirsatData = EMPTY, loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); };
let loading: Promise<void> | null = null;
function ensure(): Promise<void> { if (!loading) loading = doLoad(); return loading; }
async function doLoad() {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      const schema = Number(j.schema ?? 1);
      data = { ...EMPTY, ...j, schema: FIRSAT_SCHEMA, settings: { ...DEF_FIRSAT, ...(j.settings ?? {}), q: mergeQ(j.settings?.q) } };
      if (j.paper) {
        const start = Number(j.paper.settings?.startCapital ?? j.paper.capital) || 300;
        const base = initAccount(start, {}, typeof j.paper.day === 'string' ? j.paper.day : '');
        const k: Kademe = j.paper.kademe === 0.3 || j.paper.kademe === 0.4 || j.paper.kademe === 0.5 ? j.paper.kademe : 0.5;
        const settings = migrateSettings({ ...base.settings, ...(j.paper.settings ?? {}) }, schema);
        data.paper = { ...base, ...j.paper, kademe: k, settings };
      }
    }
  } catch { /* boş */ }
  loaded = true;
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});   // yükleme bitti: birleşik veriyi kaydet
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
  setTtl(min: number | null) { data = { ...data, settings: { ...data.settings, ttlMin: min } }; emit(); },
  setQ(patch: Partial<QSettings>) { data = { ...data, settings: { ...data.settings, q: { ...data.settings.q, ...patch } } }; emit(); },
  setStatus(t: string, s: TickerStatus) { data = { ...data, status: { ...data.status, [t]: s } }; emit(); },
  setLastScan(at: number) { data = { ...data, lastScan: at }; emit(); },
  setSent(sent: Sent[]) { data = { ...data, sent }; emit(); },
  setLog(log: SignalLog[]) { data = { ...data, log }; emit(); },
  setPaper(paper: PaperAccount | null) { data = { ...data, paper }; emit(); },
  setCards(cards: Card[]) { data = { ...data, cards: cards.slice(-40) }; emit(); },
  setPosLive(posLive: PosLive | null) { data = { ...data, posLive }; emit(); },
  archive(a: Archived) { data = { ...data, archive: [...data.archive, a].slice(-20) }; emit(); },
};
export function useFirsat(): FirsatData { return useSyncExternalStore((f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); }; }, () => data, () => data); }
