import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import RadarDetail from '@/screens/RadarDetail';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, Chip, Seg, TextField, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { radar, useRadar } from '@/ui/radarStore';
import { runRadarScan } from '@/ui/radarScan';
import { FreshnessPill } from '@/ui/FreshnessPill';
import { DIR_LABEL, inEntryWindowIst } from '@/lib/radar/text';
import { summarize, type Scored } from '@/lib/radar/track';
import type { Alert } from '@/lib/radar/engine';
import type { Direction, SignalKind } from '@/lib/radar/types';
import { buildLegs, defaultState, loadState, saveState, type StratId } from '@/lib/state';
import { marketOpen } from '@/lib/usmarket';

type Filter = 'all' | 'bull' | 'bear' | 'vol' | 'news';
const KIND_AD: Record<SignalKind, string> = {
  pcSurge: 'Put/Call yığılması', unusual: 'Olağan dışı kontrat', oiBuild: 'OI birikimi', ivJump: 'IV sıçraması', skew: 'Skew kayması',
  complacency: 'Rehavet', panic: 'Panik', pin: 'Pin riski', gamma: 'Gamma', sector: 'Sektör ayrışması', earnings: 'Bilanço', trend: 'Trend adayı',
};
const COL: Record<Direction, string> = { bull: C.pos, bear: C.neg, vol: C.warn, neutral: C.muted };
const p2 = (x: number) => String(x).padStart(2, '0');
const istHM = (ms: number) => { const d = new Date(ms + 3 * 3600000); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2).replace('.', ',')}%`;

export default function Radar({ onOpenCalc }: { onOpenCalc: () => void }) {
  const insets = useSafeAreaInsets();
  const D = useRadar();
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [showSet, setShowSet] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { radar.load(); const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const scan = async () => {
    if (busy) return; tap(); setBusy(true);
    try { await runRadarScan(); } catch { /* tarama başarısız: sessiz */ } finally { setBusy(false); }
  };
  const list = useMemo(() => D.alerts.filter(a =>
    filter === 'all' || (filter === 'news' ? !!a.news : a.direction === filter)).slice(0, 60), [D.alerts, filter]);
  // Hisse detayı (grafik): açıkken liste yerine detay ekranı gösterilir
  const [detail, setDetail] = useState<string | null>(null);
  const stats = useMemo(() => summarize(D.alerts.map(a => ({ kinds: a.kinds, direction: a.direction, spot: a.spot, emPct: a.emPct, outcome: { h2: a.outcome.h2 } }) as Scored)), [D.alerts]);
  const off = !marketOpen(now);

  const openCalc = async (a: Alert) => {
    const s0 = (await loadState()) ?? defaultState(now);
    const expiry = a.expiry ?? s0.expiry;
    const strat: StratId = a.direction === 'bear' ? 'longPut' : 'longCall';
    const legs = buildLegs(strat, a.spot, expiry, 0.35, 1);
    const tr = a.signals.find(x => x.kind === 'trend');
    const k = tr ? Number(tr.facts.strike) : NaN;
    if (isFinite(k)) legs.forEach(l => { l.strike = k; });
    await saveState({ ...s0, ticker: a.ticker, S: a.spot, expiry, strat, legs, autoStrikes: !isFinite(k), src: null, quote: null });
    onOpenCalc();
  };

  if (detail) return <RadarDetail ticker={detail} onBack={() => setDetail(null)} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Radar</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>
            {D.lastScan ? `Son tarama ${istHM(D.lastScan)} İstanbul` : 'Henüz tarama yok'} · veri gecikmeli olabilir
          </Text>
          <View style={{ marginTop: 6 }}><FreshnessPill /></View>
        </View>
        <Btn label={busy ? 'Taranıyor…' : 'Şimdi tara'} onPress={scan} kind="primary" />
      </View>

      <Card title="Piyasa nabzı">
        {D.pulse.length === 0 ? <Text style={{ color: C.muted }}>Veri yok. Taramayı çalıştır.</Text> : D.pulse.map(p => (
          <Pressable key={p.ticker} onPress={() => { tap(); setDetail(p.ticker); }} accessibilityRole="button" accessibilityLabel={`${p.ticker} grafiği`}
            style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: C.text, fontWeight: '700', width: 60 }}>{p.ticker}</Text>
            <Text style={{ color: p.changePct >= 0 ? C.pos : C.neg }}>{pct(p.changePct)}</Text>
            <Text style={{ color: C.muted }}>VWAP {p.vwapSide}</Text>
            <Text style={{ color: C.muted }}>IV rank {p.ivRank ?? '—'}</Text>
            <Text style={{ color: p.mood === 'rehavet' ? C.warn : p.mood === 'panik' ? C.neg : C.muted }}>{p.mood}</Text>
          </Pressable>
        ))}
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Hisseye dokun: strike OI/hacim grafiği, duvarlar, gamma flip, max pain.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {D.settings.watch.map(t => <Chip key={t} label={t} onPress={() => { tap(); setDetail(t); }} />)}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Seg<Filter> options={[['all', 'Tümü'], ['bull', 'Yükseliş'], ['bear', 'Düşüş'], ['vol', 'Oynaklık'], ['news', 'Haber']]} value={filter} onChange={setFilter} small />
        <Chip label={showSet ? 'Ayarları kapat' : 'Ayarlar'} onPress={() => setShowSet(v => !v)} />
      </View>

      {showSet ? (
        <Card title="Ayarlar">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: C.text }}>Uygulama açıkken seans içinde 5 dk’da bir tara</Text>
            <Switch value={D.settings.auto} onValueChange={v => radar.setSettings({ auto: v })} />
          </View>
          <TextField label="SEC iletişim e-postası (User-Agent; boşsa SEC kapalı)" value={D.settings.secUa} onChange={v => radar.setSettings({ secUa: v })} autoCapitalize="none" placeholder="ad@ornek.com" />
          <TextField label="Finnhub anahtarı (isteğe bağlı)" value={D.settings.finnhubKey} onChange={v => radar.setSettings({ finnhubKey: v })} autoCapitalize="none" />
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Radar yalnızca anahtarsız kaynakları (CBOE, Yahoo) kullanır; MarketData’ya istek atmaz.</Text>
        </Card>
      ) : null}

      {off ? <Text style={{ color: C.muted }}>Seans dışı: uyarılar yarın için not olarak listelenir.</Text> : null}
      {!inEntryWindowIst(now) && !off ? <Text style={{ color: C.muted, fontSize: 12 }}>Giriş penceresi (16:30–20:00 İstanbul) dışında. Notlar yarın için.</Text> : null}

      {list.length === 0 ? <Text style={{ color: C.muted, marginTop: 8 }}>Uyarı yok.</Text> : null}
      {list.map(a => (
        <View key={a.id} style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: COL[a.direction], fontWeight: '800', flex: 1 }}>{a.title}</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>{istHM(a.at)}{a.suppressed ? ' · bastırıldı' : a.level === 'bildirim' ? ' · bildirim' : ' · liste'}</Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 12 }}>{a.kinds.map(k => KIND_AD[k]).join(' · ')} · {DIR_LABEL[a.direction]}</Text>
          <Text selectable style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{a.body}</Text>
          <Text style={{ color: C.muted, fontSize: 11 }}>Veri {a.dataAgeSec} sn önce · {a.source}{a.delayedMin ? ` (${a.delayedMin} dk gecikmeli)` : ''}</Text>
          {a.outcome.h2 != null ? <Text style={{ color: C.muted, fontSize: 12 }}>2 saat sonra: {pct((a.outcome.h2 / a.spot - 1) * 100)}</Text> : null}
          {a.news ? <Pressable onPress={() => { tap(); if (a.news?.url) Linking.openURL(a.news.url).catch(() => {}); }}><Text style={{ color: C.blue, fontSize: 12 }}>Haber: {a.news.title}</Text></Pressable> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <Btn label="Hesapla'da aç" onPress={() => openCalc(a)} />
            <Chip label="👍" active={a.feedback === 1} onPress={() => radar.setFeedback(a.id, 1)} />
            <Chip label="👎" active={a.feedback === -1} onPress={() => radar.setFeedback(a.id, -1)} />
          </View>
        </View>
      ))}

      <Card title="İsabet (2 saat ufuk)">
        {stats.length === 0 ? <Text style={{ color: C.muted }}>Henüz ölçülmüş uyarı yok.</Text> : stats.map(r => (
          <View key={r.kind} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ color: C.text, flex: 1 }}>{KIND_AD[r.kind]}</Text>
            <Text style={{ color: C.muted, width: 40 }}>n={r.n}</Text>
            <Text style={{ color: C.text, width: 60 }}>{r.hitPct == null ? '—' : `%${r.hitPct}`}</Text>
            <Text style={{ color: C.muted, width: 70 }}>{r.avgMovePct == null ? '—' : pct(r.avgMovePct)}</Text>
            <Text style={{ color: C.muted, width: 60 }}>{r.avgEm == null ? '—' : `${r.avgEm.toFixed(2).replace('.', ',')}×EM`}</Text>
          </View>
        ))}
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Yatırım tavsiyesi değildir. Kâğıt üstünde izle; 4–6 haftalık veriyle eşik kalibrasyonu yapılacak.</Text>
      </Card>
      <View style={{ height: insets.bottom }} />
    </ScrollView>
  );
}
