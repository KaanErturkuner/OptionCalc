import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Seg, Btn, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { registerFlowPush } from '@/ui/flowPush';
import { akisPrefs, useAkisPrefs } from '@/ui/akisStore';
import { AkisFiltre } from '@/ui/AkisFiltre';
import { AkisListe } from '@/ui/AkisListe';
import { AkisDagilim } from '@/ui/AkisDagilim';
import { loadState } from '@/lib/state';
import { fetchFlow, flowKeyOf, type FlowFeed } from '@/lib/flow/client';
import { fmtIst, type FlowEvent } from '@/lib/flow/model';
import { groupByDay, FLOW_DAYS_DEFAULT } from '@/lib/flow/days';
import { applyFlowFilters, dayTargets, tickersIn, type AkisView, type FlowFilters } from '@/lib/flow/filter';
import { aggregateByStrike, distSummary, spotOf } from '@/lib/flow/distribution';
import { interpretDistribution } from '@/lib/flow/yorum';
import { fmt } from '@/lib/format';

const REFRESH_MS = 60000;

/** Olağandışı opsiyon akışı: sunucudan (MarketData tek istemci) gelen son olaylar. Bilgi amaçlıdır, sinyal değildir. */
export default function Akis({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const [feed, setFeed] = useState<FlowFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [flowKey, setFlowKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<string | null>(null);
  const { filters, view, dagTicker } = useAkisPrefs();

  useEffect(() => { akisPrefs.load(); }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      setNoKey(!key); setFlowKey(key);
      if (!key) { setErr(null); setFeed(null); return; }
      const f = await fetchFlow(key, { limit: 2000, days: FLOW_DAYS_DEFAULT });
      setFeed(f); setErr(null);
      setPush(await registerFlowPush(key));
    } catch (e) {
      setErr((e as Error).message || 'Veri alınamadı');
    } finally {
      setBusy(false);
    }
  }, []);

  // Sekme açılınca ilk yenileme (zamanlayıcı ile: effect gövdesinde senkron setState yok) ve dakikada bir
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [active, refresh]);

  const events: FlowEvent[] = useMemo(() => feed?.events ?? [], [feed]);
  const now = feed?.serverTime ?? 0; // feed yoksa olay da yok; render içinde Date.now() kullanılmaz
  const tickers = useMemo(() => tickersIn(events), [events]);
  const filtered = useMemo(() => applyFlowFilters(events, filters, now), [events, filters, now]);
  const groups = useMemo(() => groupByDay(filtered, now), [filtered, now]);

  // Dağılım: hisse seçimi (taraf filtresi yok sayılır ki çağrı ve put birlikte görünsün)
  const pickBase = useMemo(() => applyFlowFilters(events, { ...filters, side: 'all', ticker: null }, now), [events, filters, now]);
  const pickTickers = useMemo(() => tickersIn(pickBase), [pickBase]);
  const topTicker = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of pickBase) m.set(e.ticker, (m.get(e.ticker) ?? 0) + e.prem);
    let best: string | null = null, bv = -1;
    for (const [t, v] of m) if (v > bv) { best = t; bv = v; }
    return best;
  }, [pickBase]);
  const dagActive: string | null = filters.ticker ?? (dagTicker && pickTickers.includes(dagTicker) ? dagTicker : topTicker);
  const dagEvents = useMemo(() => dagActive ? applyFlowFilters(events, { ...filters, ticker: dagActive }, now) : [], [events, filters, now, dagActive]);
  const dagRows = useMemo(() => aggregateByStrike(dagEvents), [dagEvents]);
  // Spot: hissenin tüm yüklü olaylarında en son underlying (filtreden bağımsız)
  const dagSpot = useMemo(() => dagActive ? spotOf(events.filter(e => e.ticker === dagActive)) : null, [events, dagActive]);
  const interp = useMemo(() => {
    if (!dagActive) return null;
    const s = distSummary(dagEvents);
    return interpretDistribution({ ticker: dagActive, rows: dagRows, spot: dagSpot, eventCount: s.eventCount, zeroDtePrem: s.zeroDtePrem, reconstructedCount: s.reconstructedCount });
  }, [dagActive, dagEvents, dagRows, dagSpot]);

  // AI yorum günü: Bugün/Dün ise o ET günü; 3 gün ise hissenin en yeni olay günü. Yalnız o gün olay varsa.
  const aiDay = useMemo(() => {
    if (!dagActive) return null;
    const { bugun, dun } = dayTargets(now);
    const want = filters.day === 'bugun' ? bugun : filters.day === 'dun' ? dun : null;
    const days = events.filter(e => e.ticker === dagActive).map(e => e.day);
    if (want) return days.includes(want) ? want : null;
    return days.length ? days.reduce((a, b) => (b > a ? b : a)) : null;
  }, [dagActive, events, filters.day, now]);

  const setFilters = (p: Partial<FlowFilters>) => akisPrefs.patchFilters(p);
  const setView = (v: AkisView) => akisPrefs.set({ view: v });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 10 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); refresh(); }} tintColor={C.muted} />}>
      <Card title="Olağandışı opsiyon akışı">
        {noKey ? (
          <Text style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>Akış anahtarı girilmedi. Hesapla › Ayarlar › “Akış sunucusu anahtarı” alanına gir.</Text>
        ) : err ? (
          <Text style={{ color: C.neg, fontSize: 13, lineHeight: 19 }}>{err}</Text>
        ) : feed ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              Son {feed.days ?? FLOW_DAYS_DEFAULT} işlem günü{feed.fromDay ? ` (${feed.fromDay} →)` : ''} · Tarama: {feed.polling ? 'açık (piyasa saatleri)' : 'kapalı (piyasa dışı)'} · Son yanıt {fmtIst(feed.serverTime)} İST
              {feed.creditsToday != null ? ` · Bugün kredi: ${fmt(feed.creditsToday, 0)}` : ''}
            </Text>
            {push ? <Text style={{ color: C.muted, fontSize: 12 }}>{push}</Text> : null}
          </View>
        ) : (
          <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Btn label={busy ? 'Yenileniyor…' : 'Yenile'} onPress={() => { tap(); refresh(); }} />
        </View>
        <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
          Akış, hacim artışından (dV) ve kotasyondan çıkarılır; işlem bazlı (sweep/blok) veri değildir. “Tahmini taraf” bilgi amaçlıdır, yatırım tavsiyesi değildir.
        </Text>
      </Card>

      {feed && !err && !noKey ? (
        <AkisFiltre filters={filters} tickers={tickers} shown={view === 'liste' ? filtered.length : dagEvents.length}
          total={events.length} onChange={setFilters} />
      ) : null}

      {feed && !err && !noKey ? (
        <Seg<AkisView> value={view} onChange={setView} options={[['liste', 'Liste'], ['dagilim', 'Dağılım']]} />
      ) : null}

      {events.length === 0 && feed && !err ? (
        <Card><Text style={{ color: C.muted, fontSize: 13 }}>Henüz olağandışı olay yok.</Text></Card>
      ) : null}

      {events.length > 0 && view === 'liste' && filtered.length === 0 ? (
        <Card><Text style={{ color: C.muted, fontSize: 13 }}>Bu filtrelere uyan olay yok.</Text></Card>
      ) : null}
      {events.length > 0 && view === 'liste' && filtered.length > 0 ? <AkisListe groups={groups} /> : null}

      {events.length > 0 && view === 'dagilim' ? (
        dagActive && interp ? (
          <AkisDagilim
            ticker={dagActive} rows={dagRows} spot={dagSpot} interp={interp}
            reconstructed={dagEvents.some(e => e.reconstructed)}
            tickerChoices={filters.ticker == null ? pickTickers : null}
            activeTicker={dagActive}
            onPickTicker={t => akisPrefs.set({ dagTicker: t })}
            flowKey={flowKey}
            aiDay={aiDay}
          />
        ) : (
          <Card><Text style={{ color: C.muted, fontSize: 13 }}>Bu filtrelere uyan olay yok.</Text></Card>
        )
      ) : null}
    </ScrollView>
  );
}
