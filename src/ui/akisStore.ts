/* Akış tercihleri deposu (filtreler, Liste/Dağılım, Dağılım hissesi). AsyncStorage anahtarı: akis-filters-v1. Kurallar src/lib/flow/filter.ts'te. */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFS, validPrefs, type AkisPrefs } from '@/lib/flow/filter';

const KEY = 'akis-filters-v1';
let data: AkisPrefs = DEFAULT_PREFS, loaded = false;
const subs = new Set<() => void>();
const emit = () => { subs.forEach(f => f()); if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); };
let loading: Promise<void> | null = null;
function ensure(): Promise<void> { if (!loading) loading = doLoad(); return loading; }
async function doLoad() {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) data = validPrefs(JSON.parse(raw));
  } catch { /* bozuk kayıt: varsayılan */ }
  loaded = true;
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});
  subs.forEach(f => f());
}

export const akisPrefs = {
  get: () => data,
  load: () => ensure(),
  /** Kısmi güncelleme (filtreler için: { filters: {...} } değil, düz alanlar). */
  set(p: Partial<AkisPrefs>) {
    data = { ...data, ...p };
    emit();
  },
  /** Filtrelerden birkaç alanı birden değiştirir */
  patchFilters(p: Partial<AkisPrefs['filters']>) {
    data = { ...data, filters: { ...data.filters, ...p } };
    emit();
  },
};
const subscribe = (f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); }; };
export function useAkisPrefs(): AkisPrefs { return useSyncExternalStore(subscribe, () => data, () => data); }
