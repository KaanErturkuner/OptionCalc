/* Tazelik göstergesi UI köprüsü: lib/freshness kayıt defterine useSyncExternalStore ile abone olur. Kalıcılık yok. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { assessAll, snapshot, subscribe, type Assessment, type Status } from '@/lib/freshness';

export interface FreshnessView { list: Assessment[]; overall: Status; sessionOpen: boolean; now: number }

/** Durum her 20 sn'de yeniden hesaplanır (kayıt değişmese de yaş ve seans değişir) */
export function useFreshness(tickMs = 20000): FreshnessView {
  const recs = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), tickMs); return () => clearInterval(t); }, [tickMs]);
  return { ...assessAll(recs, now), now };
}
