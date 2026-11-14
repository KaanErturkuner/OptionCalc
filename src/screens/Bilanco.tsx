/* Menü › Bilanço takvimi: işlem günleri şeridi; seçilen gün için piyasa öncesi / sonrası bilanço açıklayan şirketler.
 * Şirkete dokununca BilancoDetay: beklenti, bilanço haberleri, zincir özeti, Akış olayları. Bilgi amaçlıdır; tavsiye değildir. */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { fetchEarningsDay } from '@/lib/earnings/fetch';
import { groupByTiming, tradingStrip, type EarningsRow, type EarnTiming } from '@/lib/earnings/calendar';
import { etDate } from '@/lib/usmarket';
import BilancoDetay from '@/screens/BilancoDetay';

const TIMING_TITLE: Record<EarnTiming, string> = { pre: 'Piyasa öncesi', post: 'Piyasa sonrası', unknown: 'Saat belirtilmedi' };
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('tr-TR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' });
const eps = (x: number | null) => (x == null ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2).replace('.', ',')}`);

export default function Bilanco({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [now] = useState(() => Date.now());
  const days = useMemo(() => tradingStrip(now), [now]);
  const today = etDate(now);
  const [day, setDay] = useState<string>(days.find(d => d >= today) ?? days[0]);
  const [rows, setRows] = useState<EarningsRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<EarningsRow | null>(null);

  const load = async (d: string) => {
    setBusy(true); setErr(null);
    try { setRows(await fetchEarningsDay(d)); }
    catch (e) { setRows(null); setErr((e as Error).message || 'Takvim alınamadı'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => load(day), 0);
    return () => clearTimeout(t);
  }, [active, day]);

  if (sel) return <BilancoDetay row={sel} onBack={() => setSel(null)} />;

  const g = rows ? groupByTiming(rows) : null;
  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + (onBack ? 8 : 12), paddingHorizontal: 14, paddingBottom: 30, gap: 12 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); load(day); }} tintColor={C.muted} />}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 44 }} /> : null}
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Bilanço takvimi</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {days.map(d => {
          const on = d === day;
          return (
            <Pressable key={d} onPress={() => { tap(); setDay(d); }} accessibilityRole="button"
              style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? C.blue : C.border, backgroundColor: on ? C.accentSoft : C.card }}>
              <Text style={{ color: on ? C.blue : C.text, fontSize: 13, fontWeight: '700' }}>{dayLabel(d)}{d === today ? ' · bugün' : ''}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {err ? <Text style={{ color: C.neg, fontSize: 13 }}>{err} — aşağı çekip tekrar dene.</Text> : null}
      {g && rows && rows.length === 0 ? <Text style={{ color: C.muted, fontSize: 13 }}>Bu gün için bilanço kaydı yok.</Text> : null}
      {g ? (['pre', 'post', 'unknown'] as EarnTiming[]).filter(k => g[k].length).map(k => (
        <View key={k} style={{ gap: 6 }}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>{TIMING_TITLE[k]} · {g[k].length}</Text>
          {g[k].map(r => (
            <Pressable key={r.symbol} onPress={() => { tap(); setSel(r); }} accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{r.symbol}</Text>
                <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>{r.name}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.text, fontSize: 13 }}>Beklenti {eps(r.epsForecast)}</Text>
                <Text style={{ color: C.muted, fontSize: 11 }}>geçen yıl {eps(r.lastYearEps)}{r.estimates != null ? ` · ${r.estimates} analist` : ''}</Text>
              </View>
              <Text style={{ color: C.muted, fontSize: 20 }}>›</Text>
            </Pressable>
          ))}
        </View>
      )) : null}
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16 }}>
        Takvim halka açık kaynaktan alınır (resmî veri değildir; saatler şirket açıklamasına göre değişebilir). Piyasa öncesi/sonrası ABD saatine göredir.
      </Text>
    </ScrollView>
  );
}
