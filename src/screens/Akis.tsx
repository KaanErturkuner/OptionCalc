import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { registerFlowPush } from '@/ui/flowPush';
import { loadState } from '@/lib/state';
import { fetchFlow, type FlowFeed } from '@/lib/flow/client';
import { contractLabel, fmtIst, fmtIstTime, fmtUsdShort, type FlowEvent } from '@/lib/flow/model';
import { RECONSTRUCTED_LABEL } from '@/lib/flow/reconstruct';
import { groupByDay, FLOW_DAYS_DEFAULT } from '@/lib/flow/days';
import { fmt } from '@/lib/format';
import { flowKeyOf } from '@/lib/flow/client';
import { closeMs } from '@/lib/usmarket';

const REFRESH_MS = 60000;

/** Olağandışı opsiyon akışı: sunucudan (MarketData tek istemci) gelen son olaylar. Bilgi amaçlıdır, sinyal değildir. */
export default function Akis({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const [feed, setFeed] = useState<FlowFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      setNoKey(!key);
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

  const events: FlowEvent[] = feed?.events ?? [];
  const now = feed?.serverTime ?? 0; // feed yoksa olay da yok; render içinde Date.now() kullanılmaz
  const groups = groupByDay(events, now);
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

      {events.length === 0 && feed && !err ? (
        <Card><Text style={{ color: C.muted, fontSize: 13 }}>Henüz olağandışı olay yok.</Text></Card>
      ) : null}

      {groups.map(g => (
        <View key={g.day} style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: C.muted, fontSize: 13, fontWeight: '800', marginTop: 6, marginLeft: 4 }}>
            {g.label} · {g.items.length} olay
          </Text>
          {g.items.some(e => e.reconstructed) ? (
            <Text style={{ color: C.warn, fontSize: 11, lineHeight: 16, marginLeft: 4, marginBottom: 2 }}>
              Bu gün canlı taranmadı. Olaylar kapanış zincirindeki gün içi toplam hacimden {RECONSTRUCTED_LABEL.toLowerCase()} (2 dk tarama değil). Saat kapanıştır (16:00 ET); gün içi an uydurulmadı.
            </Text>
          ) : null}
          {g.items.map(e => (
          <Card key={e.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{contractLabel(e)}</Text>
              <Text style={{ color: e.side === 'call' ? C.pos : C.neg, fontSize: 12, fontWeight: '800' }}>{e.side === 'call' ? 'CALL' : 'PUT'}</Text>
            </View>
            <Text style={{ color: C.text, fontSize: 13, marginTop: 4 }}>
              Hacim Δ {fmt(e.dv, 0)} · prim ~{fmtUsdShort(e.prem)} · orta {fmt(e.mid, 2)}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
              OI {fmt(e.oi, 0)} · Hacim/OI {fmt(e.volOi, 2)} · {eventTimeLabel(e)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              {e.reconstructed
                ? <Badge text={RECONSTRUCTED_LABEL} color={C.warn} />
                : <Badge text={e.confirmed ? 'Teyitli (canlı)' : 'Teyitsiz'} color={e.confirmed ? C.pos : C.muted} />}
              {e.wide ? <Badge text="Geniş spread" color={C.warn} /> : null}
              {e.pushed ? <Badge text="Bildirim gönderildi" color={C.blue} /> : null}
            </View>
          </Card>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/** Yeniden kurulmuş ve zamanı kapanışsa "kapanış"; çubuktan gelen gerçek an varsa İstanbul saati. */
function eventTimeLabel(e: FlowEvent): string {
  if (e.reconstructed && Math.abs(e.ts - closeMs(e.day)) < 60000) return 'kapanış (16:00 ET)';
  return `${fmtIstTime(e.ts)} İST`;
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <Text style={{ color, fontSize: 11, fontWeight: '700', borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>{text}</Text>
  );
}
