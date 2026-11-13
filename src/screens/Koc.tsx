/* Menü › Koç: Midas işlem ekran görüntüsü → sunucu (Haiku) → işlem listesi, kural kontrolleri, geri bildirim ve günün karnesi.
 * Eğitim amaçlıdır; yatırım tavsiyesi DEĞİLDİR. Görsel seçici kurulu değilse (expo-image-picker) yükleme devre dışı kalır, açıklama gösterilir. */
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { fetchCoachDay, makeKarne, uploadScreenshot, type CoachDayView } from '@/lib/coach/client';
import { addDaysStr, etDate } from '@/lib/usmarket';
import { pickScreenshot, PICKER_MISSING } from '@/ui/coachPicker';
import CoachReport from '@/ui/CoachReport';

const REFRESH_MS = 60000;
const dayLabel = (d: string) => d.split('-').reverse().join('.');

export default function Koc({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [day, setDay] = useState(() => etDate(Date.now()));
  const [view, setView] = useState<CoachDayView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'load' | 'upload' | 'karne' | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [pickerOk, setPickerOk] = useState(true);

  const load = useCallback(async (d: string) => {
    setBusy('load');
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      setNoKey(!key);
      if (!key) { setView(null); setErr(null); return; }
      setView(await fetchCoachDay(key, d));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || 'Veri alınamadı');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void load(day), 0);
    const id = setInterval(() => void load(day), REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [active, day, load]);

  const upload = async () => {
    tap();
    const p = await pickScreenshot();
    if (!p.ok) { setPickerOk(false); setErr(p.reason); return; }
    setBusy('upload'); setErr(null); setNotice(null);
    try {
      const st = await loadState();
      const r = await uploadScreenshot(flowKeyOf(st?.flowKey), { base64: p.base64, mime: p.mime, day });
      setNotice(r.warning ? `Uyarı: ${r.warning}` : `${r.trades.length} işlem işlendi (${r.model}${r.fallback ? ', yedek model' : ''}). Girdi ${r.usage.inTok} / çıktı ${r.usage.outTok} token.`);
      await load(day);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const karne = async () => {
    tap();
    setBusy('karne'); setErr(null);
    try {
      const st = await loadState();
      await makeKarne(flowKeyOf(st?.flowKey), day);
      await load(day);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <View style={{ gap: 8 }}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 36 }} /> : null}
      <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>Koç</Text>
      <Text style={{ color: C.muted, fontSize: 12 }}>Eğitim amaçlı geri bildirim. Yatırım tavsiyesi değildir.</Text>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 12 }}
      refreshControl={<RefreshControl refreshing={busy === 'load'} onRefresh={() => load(day)} tintColor={C.muted} />}>
      {header}

      <Card title="Gün">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn label="‹ Önceki" onPress={() => { tap(); setDay(addDaysStr(day, -1)); }} />
          <Text style={{ color: C.text, fontWeight: '700' }}>{dayLabel(day)}</Text>
          <Btn label="Sonraki ›" onPress={() => { tap(); setDay(addDaysStr(day, 1) > etDate(Date.now()) ? day : addDaysStr(day, 1)); }} />
          <Btn label="Bugün" onPress={() => { tap(); setDay(etDate(Date.now())); }} />
        </View>
      </Card>

      <Card title="Ekran görüntüsü">
        <Text style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>
          Midas işlem ekranını yükle (PNG/JPEG, en çok 4 MB). Koç işlemi okur, kurallara ve çıkıştan sonraki fiyat hareketine bakar.
          Günde en çok 20 yükleme; iki yükleme arası en az 10 sn.
        </Text>
        {pickerOk ? null : <Text style={{ color: C.neg, fontSize: 12, marginBottom: 6 }}>{PICKER_MISSING}</Text>}
        <Btn label={busy === 'upload' ? 'Yükleniyor…' : 'Görüntü yükle'} onPress={() => { void upload(); }} style={{ alignSelf: 'flex-start' }} />
      </Card>

      {noKey ? <Card title="Anahtar"><Text style={{ color: C.muted }}>Akış anahtarı girilmedi (Hesapla › Ayarlar). Koç aynı anahtarla çalışır.</Text></Card> : null}
      {err ? <Card title="Hata"><Text style={{ color: C.neg }}>{err}</Text></Card> : null}
      {notice ? <Card><Text style={{ color: C.muted, fontSize: 13 }}>{notice}</Text></Card> : null}
      {busy === 'load' && !view ? <Text style={{ color: C.muted }}>Yükleniyor…</Text> : null}

      {view && view.trades.length === 0 ? (
        <Card><Text style={{ color: C.muted }}>Bu gün için koçluk kaydı yok.</Text></Card>
      ) : null}

      {view?.trades.map((t, i) => t.report ? (
        <CoachReport key={t.id} r={t.report} index={i + 1} ts={t.ts} />
      ) : (
        <Card key={t.id} title={`${i + 1}. ${t.trade.ticker} ${t.trade.strike}${t.trade.side === 'CALL' ? 'C' : 'P'}`}>
          <Text style={{ color: C.muted, fontSize: 13 }}>Koçluk metni bu kayıtta yok (doğrulama uyarısına bak).</Text>
        </Card>
      ))}

      {view ? (
        <Card title="Günün karnesi">
          {view.karne ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: C.text, fontSize: 13 }}>{view.karne.body.ozet}</Text>
              {view.karne.body.guclu.length ? <Text style={{ color: C.text, fontSize: 13 }}>Güçlü yanlar: {view.karne.body.guclu.join(' · ')}</Text> : null}
              {view.karne.body.tekrarlayanHata.length ? <Text style={{ color: C.text, fontSize: 13 }}>Tekrarlayan hatalar: {view.karne.body.tekrarlayanHata.join(' · ')}</Text> : null}
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>Yarın tek odak: {view.karne.body.yarinOdak}</Text>
            </View>
          ) : <Text style={{ color: C.muted, fontSize: 13 }}>Karne henüz yok. Kapanıştan 20 dk sonra otomatik üretilir; istersen şimdi üret.</Text>}
          <Btn label={busy === 'karne' ? 'Üretiliyor…' : view.karne ? 'Karneyi yenile' : 'Karne üret'} onPress={() => { void karne(); }}
            style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </Card>
      ) : null}

      {view ? <Text style={{ color: C.muted, fontSize: 11 }}>Bu gün: {view.usage.calls} çağrı · girdi {view.usage.inTok} / çıktı {view.usage.outTok} token</Text> : null}
    </ScrollView>
  );
}
