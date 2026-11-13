/* Radar hisse detayı: strike başına OI/hacim grafiği + duvarlar, gamma flip, max pain, spot.
 * Veri: TEK zincir isteği, en yakın vade, önbellekli mod. Sunucu anahtarı varsa MarketData (proxy), yoksa CBOE (anahtarsız). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MD from '@/lib/market';
import type { Chain } from '@/lib/market/types';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { Btn, Card, Seg, s, tap } from '@/ui/controls';
import OiLadder from '@/ui/OiLadder';
import { C } from '@/ui/theme';
import { num, trDate } from '@/lib/format';
import { istanbulStamp } from '@/lib/watchlist/model';
import { closeMs, DAY_MS } from '@/lib/usmarket';
import { bucketRows, markers, nearestExpiry, strikeRows, windowRows, type Markers, type Metric, type StrikeRow } from '@/lib/radar/detail';

const WINDOW_PCT = 0.25, MAX_BARS = 80, CHAIN_LIMIT = 80;
type St = { status: 'loading' } | { status: 'error'; err: string } | { status: 'ready'; ch: Chain; provider: 'marketdata' | 'cboe'; expiry: string; at: number };

export default function RadarDetail({ ticker, onBack }: { ticker: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [metric, setMetric] = useState<Metric>('oi');
  const [st, setSt] = useState<St>({ status: 'loading' });
  const reqRef = useRef(0), mounted = useRef(false);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setSt({ status: 'loading' });
    try {
      const s0 = await loadState();
      const key = flowKeyOf(s0?.flowKey);
      const now = Date.now(), exp = nearestExpiry(now);
      if (!exp) throw new Error('Yakın vade bulunamadı');
      const p = key ? 'marketdata' as const : 'cboe' as const;
      const ch = await MD.loadChain(p, ticker, exp, { marketdata: key || undefined }, CHAIN_LIMIT, { mdMode: 'cached', mdMaxAge: '2min' });
      if (my !== reqRef.current || !mounted.current) return;
      if (!(ch.underlying && ch.underlying > 0)) throw new Error('Hisse fiyatı gelmedi');
      setSt({ status: 'ready', ch, provider: p, expiry: exp, at: Date.now() });
    } catch (e: any) {
      if (my === reqRef.current && mounted.current) setSt({ status: 'error', err: e?.message || 'Veri alınamadı' });
    }
  }, [ticker]);

  // Açılışta bir kez (ertelenmiş); kapanınca bekleyen yanıt yok sayılır
  useEffect(() => { mounted.current = true; const t = setTimeout(load, 0); return () => { clearTimeout(t); mounted.current = false; }; }, [load]);

  const ready = st.status === 'ready' ? st : null;
  const spot = ready?.ch.underlying ?? null;
  const all: StrikeRow[] = useMemo(() => ready ? strikeRows(ready.ch) : [], [ready]);
  const rows: StrikeRow[] = useMemo(() => spot ? bucketRows(windowRows(all, spot, WINDOW_PCT, 200), MAX_BARS) : [], [all, spot]);
  const marks: Markers = useMemo(() => ready && spot ? markers(ready.ch, spot, ready.at) : { spot: null, callWall: null, putWall: null, flip: null, maxPain: null }, [ready, spot]);
  const sumCall = all.reduce((a, r) => a + r.callOi, 0), sumPut = all.reduce((a, r) => a + r.putOi, 0);
  const days = ready ? Math.max(0, Math.round((closeMs(ready.expiry) - ready.at) / DAY_MS)) : 0;
  const chartW = winW - 24 - 28;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Btn label="‹ Radar" onPress={onBack} style={{ minHeight: 38 }} />
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{ticker}</Text>
        <Btn label={st.status === 'loading' ? '…' : '⟳'} onPress={() => { tap(); load(); }} style={{ minHeight: 38, paddingHorizontal: 13 }} />
      </View>

      {st.status === 'loading' ? (
        <Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><ActivityIndicator color={C.muted} /><Text style={{ color: C.muted }}>Zincir alınıyor…</Text></View></Card>
      ) : null}
      {st.status === 'error' ? (
        <Card title="Veri alınamadı">
          <Text style={{ color: C.neg }}>{st.err}</Text>
          <Text style={[s.hint, { marginTop: 6 }]}>Sunucu anahtarı yoksa CBOE kullanılır. Tekrar dene ya da ⟳’ye bas.</Text>
        </Card>
      ) : null}

      {ready ? (
        <>
          <Card>
            <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
              Hisse {num(spot!, 2)} $ · vade {trDate(ready.expiry)} ({days} gün)
            </Text>
            <Text style={[s.hint, { marginTop: 4 }]}>
              {ready.provider === 'marketdata' ? 'MarketData (sunucu, önbellekli)' : 'CBOE (anahtarsız)'} · {istanbulStamp(ready.at)} İstanbul · gecikmeli olabilir
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <Stat k="Call OI" v={sumCall.toLocaleString('tr-TR')} color={C.pos} />
              <Stat k="Put OI" v={sumPut.toLocaleString('tr-TR')} color={C.neg} />
              <Stat k="P/C (OI)" v={sumCall > 0 ? num(sumPut / sumCall, 2) : '—'} />
            </View>
          </Card>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 }}>
            <Seg<Metric> options={[['oi', 'Açık pozisyon'], ['vol', 'Hacim']]} value={metric} onChange={setMetric} small />
          </View>

          <Card title={metric === 'oi' ? 'OI × strike' : 'Hacim × strike'}>
            {rows.length ? <OiLadder rows={rows} metric={metric} marks={marks} width={chartW} spot={spot} /> : (
              <Text style={{ color: C.muted }}>Spot ±%{Math.round(WINDOW_PCT * 100)} aralığında strike yok.</Text>
            )}
            <Legend items={[
              { c: C.pos, t: 'Call (yukarı)' }, { c: C.neg, t: 'Put (aşağı)' },
              { c: C.text, t: `Spot ${spot != null ? num(spot, 2) : '—'}` },
              { c: C.pos, t: `Call duvarı ${fmtOr(marks.callWall, rows)}`, dash: true },
              { c: C.neg, t: `Put duvarı ${fmtOr(marks.putWall, rows)}`, dash: true },
              { c: C.warn, t: `Gamma flip ${fmtOr(marks.flip, rows)}`, dash: true },
              { c: C.blue, t: `Max pain ${fmtOr(marks.maxPain, rows)}`, dash: true },
            ]} />
            <Text style={[s.hint, { marginTop: 8 }]}>
              Pencere: spot ±%{Math.round(WINDOW_PCT * 100)}, en fazla {MAX_BARS} strike (yoğunsa kovalanır). En yüksek strike üstte; çizgiler strike’lar arasında enterpole. Duvarlar ve max pain tüm zincirden. Gamma flip yaklaşık (dealer gamma varsayımı). Yatırım tavsiyesi değildir.
            </Text>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const fmtOr = (v: number | null, rows: StrikeRow[]) => v == null ? '—' : inRangeLabel(v, rows);
const inRangeLabel = (v: number, rows: StrikeRow[]) => (rows.length && v >= rows[0].k && v <= rows[rows.length - 1].k) ? num(v, 2) : `${num(v, 2)} (aralık dışı)`;

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: C.muted, fontSize: 12 }}>{k}</Text>
      <Text style={{ color: color ?? C.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{v}</Text>
    </View>
  );
}

function Legend({ items }: { items: { c: string; t: string; dash?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 12, height: it.dash ? 2 : 10, borderRadius: 1, backgroundColor: it.c }} />
          <Text style={{ color: C.muted, fontSize: 12 }}>{it.t}</Text>
        </View>
      ))}
    </View>
  );
}
