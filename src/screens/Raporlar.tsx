/* Menü › Raporlar: sunucunun raporları gün klasörlerinde (en yeni gün önce). Gün içinde: en son raporun özeti üstte;
 * her rapor daraltılabilir kutu (başlıkta tür, saat ve karar rozeti). Yapılandırılmış bölümü olmayan eski satırlar düz metinle açılır.
 * Örnek (geçmiş yeniden kurulum) raporlar "örnek" etiketli. Kural tabanlıdır; yatırım tavsiyesi değildir. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import {
  BiasBadge, CalendarTimeline, EodCard, Failures, FlowStack, MetricGrid, NewsList, SectionTitle, SummaryCard, WallCard,
} from '@/ui/ReportParts';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { fetchReports, type ReportItem } from '@/lib/reports/client';
import { groupByDay, type ReportBox } from '@/lib/reports/group';
import type { ReportSections } from '@/lib/reports/types';

const REFRESH_MS = 60000;
const SUMMARY_TITLE: Record<string, string> = { premarket: 'Bugün için', intra1: 'Şu an', intra2: 'Şu an', intra3: 'Şu an', eod: 'Yarın için' };
const NA = 'veri alınamadı';

/** Bir raporun yapılandırılmış görünümü; bölüm yoksa düz metin */
function ReportContent({ r }: { r: ReportBox }) {
  const s: ReportSections | null | undefined = r.sections;
  if (!s) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>{r.title}</Text>
        <Text style={{ color: C.text, fontSize: 13.5, lineHeight: 20 }} selectable>{r.body}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <SummaryCard s={s.summary} title={SUMMARY_TITLE[r.kind] ?? 'Özet'} />
      <SectionTitle>Ölçüler</SectionTitle>
      <MetricGrid chips={s.metrics} />
      <SectionTitle>Duvarlar</SectionTitle>
      {s.walls.length ? s.walls.map(w => <WallCard key={w.ticker} w={w} />) : <Text style={{ color: C.muted, fontSize: 13 }}>{NA}</Text>}
      <SectionTitle>Takvim</SectionTitle>
      <CalendarTimeline items={s.calendar} />
      <SectionTitle>Haberler</SectionTitle>
      <NewsList items={s.news} ok={s.newsOk} />
      <SectionTitle>Opsiyon birikimi</SectionTitle>
      <FlowStack flow={s.flow} />
      {s.eod ? (
        <>
          <SectionTitle>Gün sonu incelemesi</SectionTitle>
          <EodCard eod={s.eod} />
        </>
      ) : null}
      <Failures items={s.failures} />
    </View>
  );
}

export default function Raporlar({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      setNoKey(!key);
      if (!key) { setItems([]); setErr(null); return; }
      setItems(await fetchReports(key, 50));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || 'Veri alınamadı');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [active, refresh]);

  const folders = useMemo(() => groupByDay(items), [items]);
  const folder = day ? folders.find(f => f.day === day) ?? null : null;
  /** Gün başlığının altındaki en son yapılandırılmış rapor (sabah için "Bugün için", gün içinde "Şu an") */
  const latest = useMemo(() => {
    if (!folder) return null;
    return [...folder.items].filter(r => r.sections).sort((a, b) => b.ts - a.ts)[0] ?? null;
  }, [folder]);
  const toggle = (id: number) => setOpenIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pageStyle = { padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 10 };
  const refreshControl = <RefreshControl refreshing={busy} onRefresh={() => { tap(); refresh(); }} tintColor={C.muted} />;

  if (folder) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={pageStyle} refreshControl={refreshControl}>
        <Btn label="‹ Raporlar" onPress={() => { tap(); setDay(null); setOpenIds(new Set()); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} />
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{folder.label}</Text>
        {latest?.sections ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>Son durum · {latest.boxTitle}</Text>
            <SummaryCard s={latest.sections.summary} title={SUMMARY_TITLE[latest.kind] ?? 'Özet'} />
          </View>
        ) : null}
        {folder.items.map(r => {
          const isOpen = openIds.has(r.id);
          return (
            <Card key={r.id}>
              <Pressable onPress={() => { tap(); toggle(r.id); }} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flexWrap: 'wrap' }}>
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{r.boxTitle}</Text>
                  {r.example ? (
                    <Text style={{ color: C.warn, fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: C.warn, borderRadius: 6, paddingHorizontal: 5 }}>örnek</Text>
                  ) : null}
                  {r.sections ? <BiasBadge bias={r.sections.summary.bias} dataOk={r.sections.summary.dataOk} size="sm" /> : null}
                </View>
                <Text style={{ color: C.muted, fontSize: 14 }}>{isOpen ? '▾' : '▸'}</Text>
              </Pressable>
              {isOpen ? <View style={{ marginTop: 12 }}><ReportContent r={r} /></View> : null}
            </Card>
          );
        })}
        <Text style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>Kural tabanlı otomatik özet; yatırım tavsiyesi değildir.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={pageStyle} refreshControl={refreshControl}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} /> : null}
      <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>Raporlar</Text>
      {noKey ? (
        <Card title="Anahtar gerekli"><Text style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>Akış anahtarı girilmedi. Hesapla › Ayarlar › “Akış sunucusu anahtarı”.</Text></Card>
      ) : err ? (
        <Card title="Veri alınamadı"><Text style={{ color: C.neg, fontSize: 13 }}>{err}</Text><Btn label="Yeniden dene" onPress={() => { tap(); refresh(); }} style={{ marginTop: 8 }} /></Card>
      ) : folders.length === 0 ? (
        <Card title="Henüz rapor yok"><Text style={{ color: C.muted, fontSize: 13, lineHeight: 19 }}>Raporlar işlem günlerinde piyasa öncesi (17:00 İst), açılıştan 30 dk, 1,5 ve 2,5 saat sonra ve gün sonunda üretilir. Çekmek için aşağı kaydır.</Text></Card>
      ) : folders.map(f => {
        const count = f.items.length, ex = f.examples;
        const bias = [...f.items].filter(r => r.sections).sort((a, b) => b.ts - a.ts)[0]?.sections?.summary;
        return (
          <Pressable key={f.day} onPress={() => { tap(); setDay(f.day); setOpenIds(new Set()); }} accessibilityRole="button">
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flexShrink: 1, gap: 4 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{f.label}</Text>
                  <Text style={{ color: C.muted, fontSize: 12 }}>{count} rapor{ex ? ` · ${ex} örnek` : ''}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {bias ? <BiasBadge bias={bias.bias} dataOk={bias.dataOk} size="sm" /> : null}
                  <Text style={{ color: C.muted, fontSize: 18 }}>›</Text>
                </View>
              </View>
            </Card>
          </Pressable>
        );
      })}
      <Text style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>Kural tabanlı otomatik özet; yatırım tavsiyesi değildir.</Text>
    </ScrollView>
  );
}
