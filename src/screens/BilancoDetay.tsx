/* Bilanço detayı (görsel): EPS ve gelir (beklenti / gerçek / sürpriz), geçmiş EPS grafiği, beklenen hareket (ATM straddle) ile
 * strike OI/hacim çubukları, 5 günlük olağandışı akış (call/put prim), kısa haber listesi. Her bölüm bağımsız yüklenir.
 * Veri: sunucu /earnings/history (Finnhub), CBOE zinciri ve Akış (mevcut yükleyiciler). Bilgi amaçlıdır; tavsiye değildir. */
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Card, Seg, Stat, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { earnFavs, useEarnFavs } from '@/ui/earnStore';
import { EarnChainChart, EarnEpsChart, EarnFlowChart } from '@/ui/EarnCharts';
import { fetchEarningsHistory, type EarningsItem, type EarnHistory } from '@/lib/earnings/client';
import { fmtCap, fmtEps, fmtRevenue, fmtSurprise, surpriseTone, timingOfHourLabel } from '@/lib/earnings/calendar';
import { chainBars, flowPremByDay, impliedMove, type DayPrem, type ImpliedMove } from '@/lib/earnings/charts';
import type { StrikeRow } from '@/lib/radar/detail';
import { fetchFeed, googleFeed, yahooFeed } from '@/lib/news/feeds';
import { translateMany } from '@/lib/news/translate';
import type { NewsItem } from '@/lib/news/types';
import { loadChain, loadSymbol } from '@/lib/market';
import type { Chain } from '@/lib/market/types';
import { loadState } from '@/lib/state';
import { fetchFlow, flowKeyOf } from '@/lib/flow/client';
import type { FlowEvent } from '@/lib/flow/model';

const NEWS_WINDOW_MS = 14 * 24 * 3600000;
const toneFg = (x: number | null) => (surpriseTone(x) === 'pos' ? C.pos : surpriseTone(x) === 'neg' ? C.neg : C.muted);
/** Sunucu aralığındaki en yakın vade: bilanço gününden sonraki (veya aynı gün) ilk vade; yoksa ilk vade */
const pickExpiry = (list: string[], date: string): string | null => list.find(e => e >= date) ?? list[0] ?? null;

interface ChainView { rows: StrikeRow[]; spot: number; move: ImpliedMove | null; expiry: string }

export default function BilancoDetay({ row, onBack }: { row: EarningsItem; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Kart içi genişlik: ekran yanları (14+14) + kart iç boşluğu (14+14). Grafikler bunu 160–340 pt'e sıkıştırır.
  const chartW = width - 56;
  const favs = useEarnFavs();
  const fav = favs.includes(row.symbol);
  const sym = row.symbol;

  const [hist, setHist] = useState<EarnHistory | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainView | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<'oi' | 'vol'>('oi');
  const [flow, setFlow] = useState<{ days: DayPrem[]; events: FlowEvent[] } | null>(null);
  const [flowErr, setFlowErr] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsTr, setNewsTr] = useState<Map<string, string>>(new Map());
  const [newsErr, setNewsErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await loadState();
        const h = await fetchEarningsHistory(flowKeyOf(st?.flowKey), sym);
        if (alive) setHist(h);
      } catch (e) { if (alive) setHistErr((e as Error).message || 'Geçmiş alınamadı'); }
    })();
    (async () => {
      try {
        const L = await loadSymbol(sym, 'cboe', {});
        const exp = pickExpiry(L.expirations, row.date);
        if (!exp) throw new Error('vade yok');
        const ch: Chain = await loadChain('cboe', sym, exp, {}, 80);
        const spot = L.quote.price;
        if (alive) setChain({ rows: chainBars(ch, spot, 0.12, 40), spot, move: impliedMove(ch, spot), expiry: exp });
      } catch (e) { if (alive) setChainErr((e as Error).message || 'Zincir alınamadı'); }
    })();
    (async () => {
      try {
        const st = await loadState();
        const key = flowKeyOf(st?.flowKey);
        if (!key) { if (alive) setFlowErr('Akış anahtarı girilmedi (Hesapla › Ayarlar)'); return; }
        const f = await fetchFlow(key, { limit: 500, days: 5 });
        const mine = f.events.filter(e => e.ticker === sym);
        if (alive) setFlow({ days: flowPremByDay(mine, sym), events: mine });
      } catch (e) { if (alive) setFlowErr((e as Error).message || 'Akış alınamadı'); }
    })();
    (async () => {
      try {
        const since = Date.now() - NEWS_WINDOW_MS;
        const lists = await Promise.allSettled([fetchFeed(yahooFeed([sym]), [sym], since), fetchFeed(googleFeed(`${sym} earnings`), [sym], since)]);
        const items = lists.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 5);
        if (!alive) return;
        setNews(items);
        if (items.length) { const t = await translateMany(items.map(n => n.title)); if (alive) setNewsTr(t); }
      } catch (e) { if (alive) setNewsErr((e as Error).message || 'Haber alınamadı'); }
    })();
    return () => { alive = false; };
  }, [sym, row.date]);

  const move = chain?.move ?? null;
  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 30, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Btn label="‹ Takvim" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 44 }} />
        <Pressable onPress={() => { tap(); earnFavs.toggle(sym); }} hitSlop={12} accessibilityRole="button" accessibilityLabel={fav ? 'Favoriden çıkar' : 'Favoriye ekle'}>
          <Text style={{ color: fav ? C.warn : C.muted, fontSize: 26 }}>{fav ? '★' : '☆'}</Text>
        </Pressable>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>{sym}</Text>
        <Text style={{ color: C.muted, fontSize: 13 }}>
          {row.date} · {timingOfHourLabel(row.hour)}{row.marketCapUsd != null ? ` · ${fmtCap(row.marketCapUsd)}` : ''}
          {row.quarter && row.year ? ` · Ç${row.quarter} ${row.year}` : ''}
        </Text>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Stat k="EPS beklenti" v={fmtEps(row.epsEstimate)} />
          <Stat k="EPS gerçek" v={fmtEps(row.epsActual)} color={row.epsActual == null ? C.muted : toneFg(row.surprisePct)} />
          <Stat k="Sürpriz" v={fmtSurprise(row.surprisePct) ?? '—'} color={toneFg(row.surprisePct)} />
          <Stat k="Gelir beklenti" v={fmtRevenue(row.revenueEstimate)} />
          <Stat k="Gelir gerçek" v={fmtRevenue(row.revenueActual)} />
        </View>
      </Card>

      <Card title="EPS geçmişi">
        {histErr ? <Text style={{ color: C.warn, fontSize: 13 }}>{histErr}</Text> : null}
        {!hist && !histErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {hist ? <EarnEpsChart rows={hist.items} width={chartW} /> : null}
      </Card>

      <Card title="Beklenen hareket ve strike'lar">
        {chainErr ? <Text style={{ color: C.warn, fontSize: 13 }}>{chainErr}</Text> : null}
        {!chain && !chainErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {chain ? (
          <View style={{ gap: 8 }}>
            <Seg<'oi' | 'vol'> small options={[['oi', 'OI'], ['vol', 'Hacim']]} value={metric} onChange={setMetric} style={{ alignSelf: 'stretch' }} />
            <Text style={{ color: C.text, fontSize: 13 }}>
              {move ? `±$${move.straddle.toFixed(2).replace('.', ',')} (%${move.pct.toFixed(1).replace('.', ',')})` : 'Beklenen hareket hesaplanamadı'}
              <Text style={{ color: C.muted }}>{`  · vade ${chain.expiry} · spot ${chain.spot.toFixed(2).replace('.', ',')}`}</Text>
            </Text>
            <ScrollView style={{ height: 360 }} nestedScrollEnabled showsVerticalScrollIndicator>
              <EarnChainChart rows={chain.rows} metric={metric} spot={chain.spot} move={move} width={chartW} />
            </ScrollView>
          </View>
        ) : null}
      </Card>

      <Card title="Olağandışı akış (5 gün)">
        {flowErr ? <Text style={{ color: C.warn, fontSize: 13 }}>{flowErr}</Text> : null}
        {!flow && !flowErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {flow ? (
          <View style={{ gap: 6 }}>
            <EarnFlowChart data={flow.days} width={chartW} />
            <Text style={{ color: C.muted, fontSize: 11 }}>{flow.events.length} olay · yeşil call, kırmızı put primi</Text>
          </View>
        ) : null}
      </Card>

      <Card title="Haberler (14 gün)">
        {newsErr ? <Text style={{ color: C.neg, fontSize: 13 }}>{newsErr}</Text> : null}
        {!news && !newsErr ? <Text style={{ color: C.muted, fontSize: 13 }}>Yükleniyor…</Text> : null}
        {news && news.length === 0 ? <Text style={{ color: C.muted, fontSize: 13 }}>Haber bulunamadı.</Text> : null}
        {(news ?? []).map(n => (
          <Pressable key={n.url || n.id} onPress={() => { tap(); Linking.openURL(n.url).catch(() => {}); }} accessibilityRole="link" style={{ gap: 2, paddingVertical: 5 }}>
            <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={2}>{newsTr.get(n.title.trim()) ?? n.title}</Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>{n.source}</Text>
          </Pressable>
        ))}
      </Card>
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16 }}>Zincir CBOE (15 dk gecikmeli). Bilgi amaçlıdır; tavsiye değildir.</Text>
    </ScrollView>
  );
}
