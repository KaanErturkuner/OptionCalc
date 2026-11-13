/* Veri tazelik hapı (renkli nokta + kısa metin) ve dokununca açılan detay sayfası. Yeni native bağımlılık yok (RN Modal). */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from './theme';
import { Btn, Card, s, tap } from './controls';
import { useFreshness } from './freshnessStore';
import { providerName, stamp, SHORT_LABEL, type Assessment, type Status } from '@/lib/freshness';

const COL: Record<Status, string> = { hata: C.neg, gecikmeli: C.warn, guncel: C.pos, kapali: C.muted, kullanilmiyor: C.muted };
const LEGEND: [Status, string][] = [
  ['guncel', 'yeşil: güncel'], ['gecikmeli', 'sarı: beklenenden eski'], ['hata', 'kırmızı: son deneme başarısız'],
  ['kapali', 'gri: ABD seansı dışında (son başarı ve hata detayda)'], ['kullanilmiyor', 'gri: bu kaynak henüz kullanılmadı'],
];

export function FreshnessPill() {
  const V = useFreshness();
  const [open, setOpen] = useState(false);
  const col = COL[V.overall];
  return (
    <>
      <Pressable onPress={() => { tap(); setOpen(true); }} accessibilityRole="button" accessibilityLabel={`Veri durumu: ${SHORT_LABEL[V.overall]}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
          backgroundColor: C.card2, borderWidth: StyleSheetHairline, borderColor: C.border, alignSelf: 'flex-start' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
        <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>{SHORT_LABEL[V.overall]}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: C.bg, borderRadius: 18, borderWidth: StyleSheetHairline, borderColor: C.border, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>Veri tazeliği</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>
                Genel durum: <Text style={{ color: COL[V.overall], fontWeight: '800' }}>{SHORT_LABEL[V.overall]}</Text>
                {V.sessionOpen ? '' : ' · ABD seansı şu an kapalı'}
              </Text>
              {V.list.map(a => <SourceRow key={a.source} a={a} now={V.now} />)}
              <Card style={{ marginBottom: 0 }}>
                {LEGEND.map(([st, t]) => (
                  <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COL[st] }} />
                    <Text style={{ color: C.muted, fontSize: 11, flex: 1 }}>{t}</Text>
                  </View>
                ))}
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
                  {'MarketData hisse verisi planınızda ~15 dk gecikmelidir; bu nedenle MarketData\'dan gelen hisse fiyatları “gecikmeli (15 dk)” olarak işaretlenir, taze çekildiyse yeşil gösterilir.'}
                </Text>
              </Card>
              <Btn label="Kapat" onPress={() => { tap(); setOpen(false); }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
const StyleSheetHairline = StyleSheet.hairlineWidth;

function SourceRow({ a, now }: { a: Assessment; now: number }) {
  const col = COL[a.status];
  return (
    <Card style={{ marginBottom: 0 }}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={{ color: C.text, fontSize: 14, fontWeight: '800', flex: 1 }}>{a.label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} />
          <Text style={{ color: col, fontSize: 12, fontWeight: '800' }}>{SHORT_LABEL[a.status]}</Text>
        </View>
      </View>
      <Line k="Sağlayıcı" v={a.okAt != null ? providerName(a.provider) + (a.delayNote ? ' · gecikmeli (15 dk)' : '') : '—'} />
      <Line k="Son başarı" v={stamp(a.okAt, now)} />
      <Line k="Son hata" v={a.err && a.errAt != null ? `${stamp(a.errAt, now)} — ${a.err}` : '—'} />
      {a.nextAt != null && a.nextAt > now ? <Line k="Sonraki yenileme" v={stamp(a.nextAt, now).replace(/ \(.*\)$/, '')} /> : null}
      <Line k="Beklenen aralık" v={a.status === 'kullanilmiyor' ? '—' : `${Math.round(a.intervalMs / 60000)} dk`} />
      {a.closedNote ? <Text style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Piyasa kapalı: son başarılı veri gösterilir, yeni istek beklenmez.</Text> : null}
    </Card>
  );
}
function Line({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 4, gap: 8 }}>
      <Text style={{ color: C.muted, fontSize: 11, width: 118 }}>{k}</Text>
      <Text style={{ color: C.text, fontSize: 11, flex: 1 }}>{v}</Text>
    </View>
  );
}
