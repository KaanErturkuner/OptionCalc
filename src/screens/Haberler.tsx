/* Menü › Haberler: takip listesi (Radar izleme listesi) için son 48 saatin haberleri. Birden çok anahtarsız kaynak
 * (Yahoo Finance, Google News, CNBC) birleştirilir; başlıklar otomatik Türkçeye çevrilir (orijinali altta).
 * Başlığa dokununca haber kaynağı açılır. Bilgi amaçlıdır; yatırım tavsiyesi değildir. */
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { fetchAllNews } from '@/lib/news/feeds';
import { translateMany } from '@/lib/news/translate';
import type { NewsItem } from '@/lib/news/types';
import { RADAR_WATCH } from '@/lib/radar/universe';

const WINDOW_MS = 48 * 3600000;
const clock = (t: number) => new Date(t).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
type SrcStatus = { id: string; label: string; ok: boolean; count: number; error?: string };

export default function Haberler({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [tr, setTr] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<SrcStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const now = Date.now();
      const { items: list, status: st } = await fetchAllNews(RADAR_WATCH, RADAR_WATCH, now - WINDOW_MS);
      setStatus(st);
      setItems(list);
      setAt(now);
      const translated = await translateMany(list.map(n => n.title));
      setTr(translated);
    } catch {
      setStatus([]);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [active, load]);

  const okCount = status.filter(s => s.ok).length;
  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + (onBack ? 8 : 12), paddingHorizontal: 14, paddingBottom: 30, gap: 10 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); load(); }} tintColor={C.muted} />}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 44 }} /> : null}
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Haberler</Text>
      <Text style={{ color: C.muted, fontSize: 12 }}>
        {at ? `Güncelleme ${clock(at)} · ${items.length} haber · kaynak ${okCount}/${status.length}` : 'Yükleniyor…'} · Takip listesi, son 48 saat · başlıklar Türkçe
      </Text>
      {status.filter(s => !s.ok).map(s => (
        <Text key={s.id} style={{ color: C.warn, fontSize: 12 }}>{s.label} alınamadı{s.error ? ` (${s.error})` : ''}</Text>
      ))}
      {!busy && at && items.length === 0 ? <Text style={{ color: C.muted, fontSize: 13 }}>Son 48 saatte haber bulunamadı.</Text> : null}
      {items.map(n => {
        const trTitle = tr.get(n.title.trim()) ?? n.title;
        const same = trTitle.trim() === n.title.trim();
        return (
          <Pressable key={n.url || n.id} onPress={() => { tap(); Linking.openURL(n.url).catch(() => {}); }} accessibilityRole="link"
            style={({ pressed }) => ({ padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, gap: 6, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: C.muted, fontSize: 11.5 }}>{n.source} · {clock(n.publishedAt)}</Text>
            <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }}>{trTitle}</Text>
            {!same ? <Text style={{ color: C.muted, fontSize: 11.5, fontStyle: 'italic' }}>{n.title}</Text> : null}
            {n.tickers.length ? <Text style={{ color: C.blue, fontSize: 12 }}>{n.tickers.join(' · ')}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
