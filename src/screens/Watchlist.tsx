/* Takip listesi ekranı: Hesapla'dan eklenen opsiyonların canlı fiyatı ve ekleme anından bu yana kâr/zararı.
 * Veri: tek zincir isteği (sembol+vade başına, cached mod) — sunucu proxy'si üzerinden (MD.loadChain). Yenileme: ekran açılınca,
 * çekince ile, 60 sn'de bir YALNIZ seans açıkken ve uygulama öndeyken. Vadesi dolan kalemlere istek atılmaz. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MD from '@/lib/market';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { marketOpen } from '@/lib/usmarket';
import { refreshItems } from '@/lib/watchlist/refresh';
import { rowOf, totals, type WatchRow } from '@/lib/watchlist/view';
import { istanbulStamp, isExpired, type Snapshot, type WatchItem } from '@/lib/watchlist/model';
import { watch, useWatch } from '@/ui/watchStore';
import { Btn, Card, s, tap } from '@/ui/controls';
import { C, plColor } from '@/ui/theme';
import { trDate } from '@/lib/format';

const REFRESH_MS = 60000;
const usd = (x: number, sign = false) => (x < 0 ? '−$' : sign && x > 0 ? '+$' : '$') + Math.abs(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2).replace('.', ',')}%`;
const px = (x: number | null | undefined) => (x != null && x > 0 ? '$' + x.toFixed(2).replace('.', ',') : '—');
const SRC: Record<WatchItem['entrySrc'], string> = { zincir: 'zincir mid', girilen: 'girilen', teorik: 'teorik' };

export default function Watchlist({ active, onBack }: { active: boolean; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { items } = useWatch();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [lastRef, setLastRef] = useState<number | null>(null);
  const busyRef = useRef(false), lastRefRef = useRef(0);

  useEffect(() => { watch.load(); }, []);

  const refresh = useCallback(async (force = false) => {
    if (busyRef.current) return;
    const list = watch.get().items, t = Date.now();
    setNow(t);
    // Hiç canlı kalem yoksa istek yok
    if (!list.some(it => !isExpired(it.expiry, t))) return;
    busyRef.current = true; setBusy(true);
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      const p = key ? 'marketdata' as const : 'cboe' as const;
      const r = await refreshItems(list, async (sym, exp) => ({
        chain: await MD.loadChain(p, sym, exp, { marketdata: key || undefined }, 80, { mdMode: 'cached', mdMaxAge: '2min' }),
        provider: p,
      }), t);
      const upd: Record<string, Snapshot> = {};
      r.items.forEach((it, i) => { if (it !== list[i] && it.last) upd[it.id] = it.last; });
      watch.applyLast(upd);
      setErrs(r.errors);
      lastRefRef.current = Date.now(); setLastRef(lastRefRef.current);
    } catch (e: any) {
      if (force) Alert.alert('Yenilenemedi', e?.message || 'Veri alınamadı');
    } finally { busyRef.current = false; setBusy(false); setNow(Date.now()); }
  }, []);

  // Ekran açılınca (sekme görünür olunca) bir kez; 60 sn'den yeni yenilendiyse atla
  useEffect(() => {
    if (!active) return;
    if (Date.now() - lastRefRef.current > REFRESH_MS) refresh();
  }, [active, refresh]);
  // Opsiyonel yavaş yenileme: yalnız görünür, uygulama öndeyken ve seans açıkken
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { if (AppState.currentState === 'active' && marketOpen()) refresh(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [active, refresh]);
  // Vade/gün sayıları için dakikada bir tazele (istek yok)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);

  const rows: WatchRow[] = useMemo(() => items.map(it => rowOf(it, now)), [items, now]);
  const tot = useMemo(() => totals(rows), [rows]);
  const remove = (r: WatchRow) => {
    tap();
    Alert.alert('Takipten çıkar', `${r.title} kalemi silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => watch.remove(r.id) },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: 'rgba(10,15,28,.97)', borderBottomWidth: 0.5, borderBottomColor: C.border }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Btn label="‹ Menü" onPress={onBack} style={{ minHeight: 38 }} />
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>Takip Listesi</Text>
          <Btn label={busy ? '…' : '⟳'} onPress={() => refresh(true)} style={{ minHeight: 38, paddingHorizontal: 13 }} />
        </View>
      </View>
      <ScrollView
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => refresh(true)} tintColor={C.muted} />}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      >
        {items.length === 0 ? (
          <Card title="Liste boş">
            <Text style={s.hint}>Hesapla sekmesinde bir opsiyon kur, ardından “Takip listesine ekle” ile buraya ekle. Ekleme anındaki prim ve hisse fiyatı kayda geçer.</Text>
          </Card>
        ) : (
          <Card title="Toplam kâr / zarar">
            <Text style={{ color: plColor(tot.total), fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{usd(tot.total, true)}</Text>
            <Text style={[s.hint, { marginTop: 6 }]}>
              {items.length} kalem{tot.missing ? ` · ${tot.missing} kalemin fiyatı yok` : ''}
              {lastRef ? ` · son yenileme ${istanbulStamp(lastRef)} (İstanbul)` : ' · henüz yenilenmedi'}
            </Text>
            <Text style={s.hint}>Canlı fiyat: seans içinde 60 sn’de bir, ekran açıkken. Kapalıyken yalnız açılışta/elle yenilenir.</Text>
          </Card>
        )}

        {rows.map((r, i) => {
          const it = items[i];
          const pl = r.pl;
          return (
            <Card key={r.id} title={r.title} right={<Text style={{ color: r.expired ? C.warn : C.muted, fontSize: 12.5, fontWeight: '700' }}>{r.expired ? 'Vadesi doldu' : `${r.daysLeft} gün kaldı`}</Text>}>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: -8, marginBottom: 8, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{r.occ ?? ''} · vade {trDate(it.expiry)}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <View>
                  <Text style={{ color: C.muted, fontSize: 12.5 }}>Şimdi (prim)</Text>
                  <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{px(r.price)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: plColor(pl?.total ?? 0), fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{pl ? usd(pl.total, true) : '—'}</Text>
                  <Text style={{ color: plColor(pl?.total ?? 0), fontSize: 14, fontWeight: '700' }}>{pl && pl.pct != null ? pct(pl.pct) : ''}</Text>
                </View>
              </View>
              <View style={{ marginTop: 10, gap: 4 }}>
                <Line k="Adet" v={`${it.qty} kontrat · ${it.side > 0 ? 'long' : 'short'}`} />
                <Line k="Ekleme primi" v={`${px(it.entry)} (${SRC[it.entrySrc]})`} />
                <Line k="Hisse" v={`${px(r.underlyingAdded)} → ${px(r.underlying)}`} />
                <Line k="Eklendi" v={`${r.addedStamp} (İstanbul) · ${r.days} gün önce`} />
                {r.expired ? <Text style={{ color: C.warn, fontSize: 12.5, marginTop: 4 }}>Vade doldu: son bilinen fiyat gösteriliyor, yeni istek yapılmıyor.</Text> : null}
                {!r.expired && r.stale ? <Text style={{ color: C.warn, fontSize: 12.5, marginTop: 4 }}>Fiyat 30 dk’dan eski.</Text> : null}
                {errs[it.symbol + '|' + it.expiry] ? <Text style={{ color: C.neg, fontSize: 12.5, marginTop: 4 }}>{errs[it.symbol + '|' + it.expiry]}</Text> : null}
              </View>
              <Btn label="Takipten çıkar" kind="danger" onPress={() => remove(r)} style={{ marginTop: 12, alignSelf: 'flex-end' }} />
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <Text style={{ color: C.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
      {k}: <Text style={{ color: C.text, fontWeight: '600' }}>{v}</Text>
    </Text>
  );
}
