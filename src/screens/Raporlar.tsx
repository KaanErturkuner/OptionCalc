/* Menü › Raporlar: sunucunun zamanlanmış piyasa raporları (piyasa öncesi, açılış +30 dk / +1,5 sa / +2,5 sa, gün sonu).
 * Liste: tür, İstanbul saati, başlık. Dokununca tam metin. Kural tabanlıdır; yatırım tavsiyesi değildir. */
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { fetchReports, type ReportItem } from '@/lib/reports/client';
import { fmtIstTime } from '@/lib/flow/model';

const REFRESH_MS = 60000;
const KIND_TR: Record<string, string> = { premarket: 'Piyasa öncesi', intra1: 'Açılış +30 dk', intra2: 'Açılış +1,5 sa', intra3: 'Açılış +2,5 sa', eod: 'Gün sonu' };

export default function Raporlar({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [open, setOpen] = useState<ReportItem | null>(null);
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
      setItems(await fetchReports(key, 20));
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

  const header = (
    <View style={{ gap: 8 }}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} /> : null}
      <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>Raporlar</Text>
    </View>
  );

  if (open) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
        contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 10 }}>
        <Btn label={`‹ Raporlar`} onPress={() => { tap(); setOpen(null); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} />
        <Card title={open.title}>
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>{KIND_TR[open.kind] ?? open.kind} · {open.day}</Text>
          <Text style={{ color: C.text, fontSize: 13.5, lineHeight: 20 }}>{open.body}</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 10 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); refresh(); }} tintColor={C.muted} />}>
      {header}
      {noKey ? (
        <Card title="Anahtar gerekli"><Text style={{ color: C.warn, fontSize: 13, lineHeight: 19 }}>Akış anahtarı girilmedi. Hesapla › Ayarlar › “Akış sunucusu anahtarı”.</Text></Card>
      ) : err ? (
        <Card title="Veri alınamadı"><Text style={{ color: C.neg, fontSize: 13 }}>{err}</Text><Btn label="Yeniden dene" onPress={() => { tap(); refresh(); }} style={{ marginTop: 8 }} /></Card>
      ) : items.length === 0 ? (
        <Card title="Henüz rapor yok"><Text style={{ color: C.muted, fontSize: 13, lineHeight: 19 }}>Raporlar işlem günlerinde piyasa öncesi (17:00 İst), açılıştan 30 dk, 1,5 ve 2,5 saat sonra ve gün sonunda üretilir. Çekmek için aşağı kaydır.</Text></Card>
      ) : items.map(r => (
        <Card key={r.id} title={r.title} right={<Text style={{ color: C.blue, fontSize: 12, fontWeight: '700' }}>{KIND_TR[r.kind] ?? r.kind}</Text>}>
          <Text style={{ color: C.muted, fontSize: 12 }} onPress={() => { tap(); setOpen(r); }}>
            {`${r.day} · ${fmtIstTime(r.ts)} İst · Tam metin için dokun`}
          </Text>
        </Card>
      ))}
      <Text style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>Kural tabanlı otomatik özet; yatırım tavsiyesi değildir.</Text>
    </ScrollView>
  );
}
