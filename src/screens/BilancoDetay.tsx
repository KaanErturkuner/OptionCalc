/* Bilanço detayı: beklenti, bilanço ile ilgili haberler, hissenin zincir özeti (CBOE, 15 dk gecikmeli) ve Akış olayları.
 * Her bölüm bağımsız yüklenir; biri düşerse diğerleri görünür kalır. Bilgi amaçlıdır; yatırım tavsiyesi değildir. */
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { summarizeChain, type ChainSummary, type EarningsRow } from '@/lib/earnings/calendar';
import { fetchFeed, googleFeed, yahooFeed } from '@/lib/news/feeds';
import { translateMany } from '@/lib/news/translate';
import type { NewsItem } from '@/lib/news/types';
import { loadChain, loadSymbol } from '@/lib/market';
import { mid } from '@/lib/market/types';
import { loadState } from '@/lib/state';
import { fetchFlow, flowKeyOf } from '@/lib/flow/client';
import { contractLabel, fmtIstTime, fmtUsdShort, type FlowEvent } from '@/lib/flow/model';

const NEWS_WINDOW_MS = 14 * 24 * 3600000;
const eps = (x: number | null) => (x == null ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2).replace('.', ',')}`);

export default function BilancoDetay({ row, onBack }: { row: EarningsRow; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsTr, setNewsTr] = useState<Map<string, string>>(new Map());
  const [newsErr, setNewsErr] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainSummary | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowEvent[] | null>(null);
  const [flowErr, setFlowErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const sym = row.symbol;
    (async () => {
      try {
        const since = Date.now() - NEWS_WINDOW_MS;
        const lists = await Promise.allSettled([fetchFeed(yahooFeed([sym]), [sym], since), fetchFeed(googleFeed(`${sym} earnings`), [sym], since)]);
        const items = lists.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 12);
        if (!alive) return;
        setNews(items);
        if (items.length) { const t = await translateMany(items.map(n => n.title)); if (alive) setNewsTr(t); }
      } catch (e) { if (alive) setNewsErr((e as Error).message || 'Haber alınamadı'); }
    })();
    (async () => {
      try {
        const L = await loadSymbol(sym, 'cboe', {});
        const exp = L.expirations[0];
        if (!exp) throw new Error('vade yok');
        const ch = await loadChain('cboe', sym, exp, {}, 40);
        if (alive) setChain(summarizeChain(exp, ch.calls, ch.puts));
      } catch (e) { if (alive) setChainErr((e as Error).message || 'Zincir alınamadı'); }
    })();
    (async () => {
      try {
        const st = await loadState();
        const key = flowKeyOf(st?.flowKey);
        if (!key) { if (alive) setFlowErr('Akış anahtarı girilmedi (Hesapla › Ayarlar)'); return; }
        const f = await fetchFlow(key, { limit: 500, days: 5 });
        if (alive) setFlow(f.events.filter(e => e.ticker === sym).sort((a, b) => b.prem - a.prem).slice(0, 8));
      } catch (e) { if (alive) setFlowErr((e as Error).message || 'Akış alınamadı'); }
    })();
    return () => { alive = false; };
  }, [row.symbol]);

  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 30, gap: 12 }}>
      <Btn label="‹ Takvim" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 44 }} />
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{row.symbol}</Text>
      <Text style={{ color: C.muted, fontSize: 13 }}>{row.name}</Text>

      <Card title="Bilanço beklentisi">
        <Text style={{ color: C.text, fontSize: 13 }}>EPS beklentisi: {eps(row.epsForecast)}{row.estimates != null ? ` · ${row.estimates} analist` : ''}</Text>
        <Text style={{ color: C.text, fontSize: 13 }}>Geçen yıl EPS: {eps(row.lastYearEps)}{row.lastYearDate ? ` (${row.lastYearDate})` : ''}</Text>
        {row.marketCap ? <Text style={{ color: C.muted, fontSize: 12 }}>Piyasa değeri: {row.marketCap}</Text> : null}
      </Card>

      <Card title="Bilanço haberleri (14 gün)">
        {newsErr ? <Text style={{ color: C.neg, fontSize: 13 }}>{newsErr}</Text> : null}
        {!news && !newsErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {news && news.length === 0 ? <Text style={{ color: C.muted, fontSize: 13 }}>Haber bulunamadı.</Text> : null}
        {(news ?? []).map(n => (
          <Pressable key={n.url || n.id} onPress={() => { tap(); Linking.openURL(n.url).catch(() => {}); }} accessibilityRole="link" style={{ gap: 2, paddingVertical: 6 }}>
            <Text style={{ color: C.text, fontSize: 14, fontWeight: '600' }}>{newsTr.get(n.title.trim()) ?? n.title}</Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>{n.source} · {new Date(n.publishedAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: 'short' })}</Text>
          </Pressable>
        ))}
      </Card>

      <Card title="Zincir özeti (CBOE, 15 dk gecikmeli)">
        {chainErr ? <Text style={{ color: C.warn, fontSize: 13 }}>{chainErr}</Text> : null}
        {!chain && !chainErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {chain ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: C.text, fontSize: 13 }}>Vade {chain.expiry} · OI çağrı {chain.callOi.toLocaleString('tr-TR')} / put {chain.putOi.toLocaleString('tr-TR')}</Text>
            <Text style={{ color: C.text, fontSize: 13 }}>Hacim çağrı {chain.callVol.toLocaleString('tr-TR')} / put {chain.putVol.toLocaleString('tr-TR')}</Text>
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>En yoğun çağrı strike&apos;ları (OI)</Text>
            {chain.topCalls.map(o => <Text key={'c' + o.strike} style={{ color: C.text, fontSize: 12 }}>{o.strike} C · OI {o.oi.toLocaleString('tr-TR')} · orta {mid(o).toFixed(2)}</Text>)}
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>En yoğun put strike&apos;ları (OI)</Text>
            {chain.topPuts.map(o => <Text key={'p' + o.strike} style={{ color: C.text, fontSize: 12 }}>{o.strike} P · OI {o.oi.toLocaleString('tr-TR')} · orta {mid(o).toFixed(2)}</Text>)}
          </View>
        ) : null}
      </Card>

      <Card title="Olağandışı akış (son 5 işlem günü)">
        {flowErr ? <Text style={{ color: C.warn, fontSize: 13 }}>{flowErr}</Text> : null}
        {!flow && !flowErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {flow && flow.length === 0 ? <Text style={{ color: C.muted, fontSize: 13 }}>Bu hisse için olağandışı akış yok.</Text> : null}
        {(flow ?? []).map(e => (
          <Text key={e.id} style={{ color: C.text, fontSize: 12, lineHeight: 18 }}>
            {contractLabel(e)} · {fmtUsdShort(e.prem)} · {fmtIstTime(e.ts)}
          </Text>
        ))}
      </Card>
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16 }}>Akış ve zincir bilgi amaçlıdır; sinyal veya tavsiye değildir.</Text>
    </ScrollView>
  );
}
