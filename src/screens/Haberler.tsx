/* Menü › Haberler: takip listesi (Radar izleme listesi) için son 48 saatin haberleri (Yahoo RSS, anahtarsız).
 * Liste tazelenir; başlığa dokununca haber kaynağı açılır. Bilgi amaçlıdır; yatırım tavsiyesi değildir. */
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { fetchYahooNews } from '@/lib/news/yahoo';
import type { NewsItem } from '@/lib/news/types';
import { RADAR_WATCH } from '@/lib/radar/universe';

const WINDOW_MS = 48 * 3600000;
const clock = (t: number) => new Date(t).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Haberler({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const now = Date.now();
      const list = await fetchYahooNews(RADAR_WATCH, RADAR_WATCH, now - WINDOW_MS);
      const seen = new Set<string>();
      const uniq = list.filter(n => (seen.has(n.url) ? false : (seen.add(n.url), true)))
        .sort((a, b) => b.publishedAt - a.publishedAt);
      setItems(uniq); setAt(now);
    } catch (e) {
      setErr((e as Error).message || 'Haberler alınamadı');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [active, load]);

  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: onBack ? 8 : insets.top + 12, paddingHorizontal: 14, paddingBottom: 30, gap: 10 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); load(); }} tintColor={C.muted} />}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} /> : null}
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Haberler</Text>
      <Text style={{ color: C.muted, fontSize: 12 }}>
        {at ? `Son güncelleme ${clock(at)} · ${items.length} haber` : 'Yükleniyor…'} · Takip listesi, son 48 saat
      </Text>
      {err ? <Text style={{ color: C.neg, fontSize: 13 }}>{err} — aşağı çekip tekrar dene.</Text> : null}
      {!busy && at && items.length === 0 && !err ? <Text style={{ color: C.muted, fontSize: 13 }}>Son 48 saatte haber bulunamadı.</Text> : null}
      {items.map(n => (
        <Pressable key={n.url} onPress={() => { tap(); Linking.openURL(n.url).catch(() => {}); }} accessibilityRole="link"
          style={({ pressed }) => ({ padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, gap: 6, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: C.muted, fontSize: 11.5 }}>{n.source} · {clock(n.publishedAt)}</Text>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }}>{n.title}</Text>
          {n.tickers.length ? <Text style={{ color: C.blue, fontSize: 12 }}>{n.tickers.join(' · ')}</Text> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}
