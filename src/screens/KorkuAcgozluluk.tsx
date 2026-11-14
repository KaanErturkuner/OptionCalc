/* Menü › Korku ve Açgözlülük: kendi bileşik endeksimiz (CNN değil). Tek bakışta okunur: büyük puan, renkli ölçek,
 * bileşen çubukları ve sade açıklamalar. Bilgi amaçlıdır; yatırım tavsiyesi değildir. */
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { fetchSentiment, type SentimentSnapshot } from '@/lib/sentiment/fetch';
import { rating } from '@/lib/sentiment/fng';

/** Bant renkleri: korkudan açgözlülüğe */
const BAND = [
  { from: 0, to: 25, label: 'Aşırı korku', color: '#dc2626' },
  { from: 25, to: 45, label: 'Korku', color: '#f97316' },
  { from: 45, to: 56, label: 'Nötr', color: '#9ca3af' },
  { from: 56, to: 76, label: 'Açgözlülük', color: '#84cc16' },
  { from: 76, to: 101, label: 'Aşırı açgözlülük', color: '#16a34a' },
];
const colorOf = (score: number) => (BAND.find(b => score >= b.from && score < b.to) ?? BAND[2]).color;

const HOW: Record<string, string> = {
  vix: 'VIX (oynaklık) yükseldikçe korku artar. Burada ters çevrildi: düşük VIX = açgözlülük.',
  momentum: 'S&P 500 ETF (SPY) son 50 günlük ortalamasının üstündeyse açgözlülük.',
  safeHaven: 'Hisseler tahvilden iyi getiriyorsa açgözlülük (son 20 gün).',
  junk: 'Yüksek getirili tahvil (HYG) yatırım sınıfı tahvile (LQD) göre güçlüyse açgözlülük.',
};

export default function KorkuAcgozluluk({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [snap, setSnap] = useState<SentimentSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true); setErr(null);
    try { setSnap(await fetchSentiment()); }
    catch (e) { setErr((e as Error).message || 'Veri alınamadı'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [active]);

  const r = snap?.result;
  const score = r?.score ?? null;
  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + (onBack ? 8 : 12), paddingHorizontal: 14, paddingBottom: 30, gap: 12 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); load(); }} tintColor={C.muted} />}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 44 }} /> : null}
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Korku ve Açgözlülük</Text>
      <Text style={{ color: C.muted, fontSize: 12, lineHeight: 17 }}>
        Piyasanın duygu durumunu 0–100 arasında ölçer. 0 = aşırı korku, 100 = aşırı açgözlülük. Bu CNN&apos;in endeksi değil; kendi hesaplamamız.
      </Text>

      {err ? <Card><Text style={{ color: C.neg, fontSize: 13 }}>{err} — aşağı çekip tekrar dene.</Text></Card> : null}
      {!snap && !err ? <Card><Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text></Card> : null}

      {r && score != null ? (
        <Card>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ color: colorOf(score), fontSize: 64, fontWeight: '900' }}>{score}</Text>
            <Text style={{ color: colorOf(score), fontSize: 18, fontWeight: '700' }}>{rating(score)}</Text>
          </View>

          {/* Renkli ölçek: 5 bant, işaretçi puanın konumunda */}
          <View style={{ marginTop: 14 }}>
            <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' }}>
              {BAND.map(b => <View key={b.label} style={{ flex: b.to - b.from, backgroundColor: b.color, opacity: 0.85 }} />)}
            </View>
            <View style={{ height: 0 }}>
              <View style={{ position: 'absolute', left: `${Math.min(99, Math.max(0, score))}%`, top: -22, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: C.text, borderWidth: 2, borderColor: C.bg }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: C.muted, fontSize: 11 }}>Korku</Text>
              <Text style={{ color: C.muted, fontSize: 11 }}>Nötr</Text>
              <Text style={{ color: C.muted, fontSize: 11 }}>Açgözlülük</Text>
            </View>
          </View>
        </Card>
      ) : null}

      {r ? (
        <Card title="Bileşenler">
          {r.components.map(c => (
            <View key={c.key} style={{ gap: 4, paddingVertical: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '600' }}>{c.label}</Text>
                <Text style={{ color: c.score == null ? C.muted : colorOf(c.score), fontSize: 14, fontWeight: '700' }}>
                  {c.score == null ? 'veri yok' : Math.round(c.score)}
                </Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden' }}>
                <View style={{ width: `${c.score ?? 0}%`, height: 8, backgroundColor: c.score == null ? C.muted : colorOf(c.score) }} />
              </View>
              <Text style={{ color: C.muted, fontSize: 11.5, lineHeight: 16 }}>{HOW[c.key]}</Text>
            </View>
          ))}
          <Text style={{ color: C.muted, fontSize: 11.5, lineHeight: 16, marginTop: 4 }}>
            Puan, kullanılabilen bileşenlerin eşit ağırlıklı ortalamasıdır ({r.used} bileşen). Put/call bileşeni henüz yok.
          </Text>
        </Card>
      ) : null}

      {snap?.asOf ? <Text style={{ color: C.muted, fontSize: 12 }}>Son kapanış verisi: {snap.asOf} (ABD)</Text> : null}
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16 }}>
        Bilgi amaçlıdır; tek başına alım veya satım sinyali değildir. Yatırım tavsiyesi değildir.
      </Text>
    </ScrollView>
  );
}
