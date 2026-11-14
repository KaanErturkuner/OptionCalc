/* Menü › Bilanço takvimi: ay / hafta ızgarası (gün başına şirket sayısı), seçilen gün: piyasa öncesi (BMO) ve sonrası (AMC).
 * Yıldız = favori (cihazda + sunucuda; sonuç açıklanınca bildirim). Veri: sunucu /earnings (Finnhub); küçük şirketler (< 2 mlr)
 * yalnız izleme listesi / favoriyse görünür. Bilgi amaçlıdır; tavsiye değildir. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Seg, tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { useWatch } from '@/ui/watchStore';
import { earnFavs, useEarnFavs } from '@/ui/earnStore';
import { fetchEarnings, type EarningsItem, type EarningsRange } from '@/lib/earnings/client';
import { countsByDay, fmtEps, fmtSurprise, groupByTiming, monthFetchSpan, monthGrid, shiftMonth, TIMING_TITLE, weekOf, weekTitle, surpriseTone, type EarnTiming } from '@/lib/earnings/calendar';
import { RangeCache } from '@/lib/earnings/rangeCache';
import { addDaysStr, etDate } from '@/lib/usmarket';
import { flowKeyOf } from '@/lib/flow/client';
import { loadState } from '@/lib/state';
import BilancoDetay from '@/screens/BilancoDetay';

type Mode = 'month' | 'week';
const WD = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
/** Cihaz içi aralık önbelleği (bellek; 10 dk). Pull-to-refresh bu önbelleği atlar. */
const rangeCache = new RangeCache<EarningsRange>(10 * 60000);
const monthTitle = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString('tr-TR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const pad2 = (n: number) => String(n).padStart(2, '0');
const dayNum = (iso: string) => String(Number(iso.slice(8, 10)));
const chipBg = (x: number | null) => (surpriseTone(x) === 'pos' ? 'rgba(34,197,94,.18)' : surpriseTone(x) === 'neg' ? 'rgba(239,68,68,.18)' : C.card2);
const chipFg = (x: number | null) => (surpriseTone(x) === 'pos' ? C.pos : surpriseTone(x) === 'neg' ? C.neg : C.muted);

export default function Bilanco({ active, onBack }: { active: boolean; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const [now] = useState(() => Date.now());
  const today = etDate(now);
  const watch = useWatch();
  const favs = useEarnFavs();
  const [mode, setMode] = useState<Mode>('month');
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState(today);
  const [data, setData] = useState<EarningsRange | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<EarningsItem | null>(null);

  // Ay: görünen ay ± 7 gün (kenar haftaları da dolu olsun); hafta: pazartesi–pazar.
  const span = useMemo(() => (mode === 'month' ? monthFetchSpan(ym.y, ym.m) : { from: weekOf(anchor)[0], to: weekOf(anchor)[6] }), [mode, ym, anchor]);
  const watchKey = useMemo(() => [...new Set([...watch.items.map(i => i.symbol), ...favs])].sort().join(','), [watch.items, favs]);

  const load = useCallback(async (force = false) => {
    const ck = `${span.from}|${span.to}|${watchKey}`;
    if (!force) {
      const hit = rangeCache.get(ck, Date.now());
      if (hit) { setErr(null); setData(hit); return; }
    }
    setBusy(true); setErr(null);
    try {
      const st = await loadState();
      const key = flowKeyOf(st?.flowKey);
      const range = await fetchEarnings(key, span.from, span.to, watchKey ? watchKey.split(',') : []);
      rangeCache.set(ck, range, Date.now());
      setData(range);
    } catch (e) { setData(null); setErr((e as Error).message || 'Takvim alınamadı'); }
    finally { setBusy(false); }
  }, [span.from, span.to, watchKey]);

  useEffect(() => {
    if (!active) return;
    void earnFavs.load().then(() => earnFavs.syncNow());   // açılışta favoriler sunucuya (token değişmiş olabilir)
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [active, load]);

  if (open) return <BilancoDetay row={open} onBack={() => setOpen(null)} />;

  const items = data?.items ?? [];
  const counts = countsByDay(items);
  const wk = weekOf(anchor);
  const grid = mode === 'month' ? monthGrid(ym.y, ym.m) : [wk];
  const dayItems = items.filter(it => it.date === sel);
  const g = groupByTiming(dayItems);
  // Gezinme: seçili gün, yeni görünümde bugünse bugün, değilse görünümün ilk günü (liste boş kalmasın).
  const step = (dir: number) => {
    tap();
    if (mode === 'month') {
      const nx = shiftMonth(ym.y, ym.m, dir);
      const mon = `${nx.y}-${pad2(nx.m)}`;
      setYm(nx); setSel(today.startsWith(mon) ? today : `${mon}-01`);
    } else {
      const na = addDaysStr(anchor, dir * 7);
      setAnchor(na); setSel(today >= weekOf(na)[0] && today <= weekOf(na)[6] ? today : weekOf(na)[0]);
    }
  };
  const changeMode = (m: Mode) => {
    tap();
    setMode(m);
    if (m === 'week') setAnchor(sel);
    else setYm({ y: Number(sel.slice(0, 4)), m: Number(sel.slice(5, 7)) });
  };
  const title = mode === 'month' ? monthTitle(ym.y, ym.m) : weekTitle(wk[0], wk[6]);

  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + (onBack ? 8 : 12), paddingHorizontal: 14, paddingBottom: 30, gap: 12 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { tap(); void load(true); }} tintColor={C.muted} />}>
      {onBack ? <Btn label="‹ Menü" onPress={() => { tap(); onBack(); }} style={{ alignSelf: 'flex-start', minHeight: 44 }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Bilanço</Text>
        <Seg<Mode> small options={[['month', 'Ay'], ['week', 'Hafta']]} value={mode} onChange={changeMode} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <Pressable onPress={() => step(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={mode === 'month' ? 'Önceki ay' : 'Önceki hafta'} style={{ padding: 8, minWidth: 44, alignItems: 'center' }}><Text style={{ color: C.blue, fontSize: 22 }}>‹</Text></Pressable>
        <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'center' }} numberOfLines={2}>{title}</Text>
        <Pressable onPress={() => step(1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={mode === 'month' ? 'Sonraki ay' : 'Sonraki hafta'} style={{ padding: 8, minWidth: 44, alignItems: 'center' }}><Text style={{ color: C.blue, fontSize: 22 }}>›</Text></Pressable>
      </View>

      <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 0.5, borderColor: C.border, padding: 6, gap: 4 }}>
        <View style={{ flexDirection: 'row' }}>
          {WD.map(w => <Text key={w} style={{ flex: 1, textAlign: 'center', color: C.muted, fontSize: 11, fontWeight: '700' }}>{w}</Text>)}
        </View>
        {grid.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap: 2 }}>
            {row.map((d, ci) => {
              if (!d) return <View key={ci} style={{ flex: 1, minHeight: mode === 'month' ? 46 : 64 }} />;
              const c = counts.get(d);
              const on = d === sel;
              return (
                <Pressable key={d} onPress={() => { tap(); setSel(d); }} accessibilityRole="button" accessibilityLabel={`${d}, ${c?.total ?? 0} bilanço`}
                  style={{ flex: 1, minHeight: mode === 'month' ? 46 : 64, borderRadius: 10, alignItems: 'center', paddingTop: 4, gap: 3,
                    backgroundColor: on ? C.accentSoft : 'transparent', borderWidth: d === today ? 1 : 0, borderColor: C.blue }}>
                  <Text style={{ color: on ? C.blue : C.text, fontSize: 13, fontWeight: d === today ? '800' : '500' }}>{dayNum(d)}</Text>
                  {c ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      {c.pre > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.blue }} /> : null}
                      {c.post > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.warn }} /> : null}
                      <Text style={{ color: C.muted, fontSize: 10 }}>{c.total}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.blue }} /><Text style={{ color: C.muted, fontSize: 11 }}>öncesi</Text></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.warn }} /><Text style={{ color: C.muted, fontSize: 11 }}>sonrası</Text></View>
        <Text style={{ color: C.muted, fontSize: 11 }}>★ favori · sayı = şirket</Text>
      </View>

      {err ? <Text style={{ color: C.neg, fontSize: 13 }}>{err} — aşağı çekip tekrar dene.</Text> : null}

      <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{dayLong(sel)}</Text>
      {data && dayItems.length === 0 ? <Text style={{ color: C.muted, fontSize: 13 }}>Bu gün için görünür bilanço yok.</Text> : null}
      {(['pre', 'post', 'unknown'] as EarnTiming[]).filter(k => g[k].length).map(k => (
        <View key={k} style={{ gap: 6 }}>
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>{TIMING_TITLE[k].toUpperCase()} · {g[k].length}</Text>
          {g[k].map(r => <CompactRow key={r.symbol} r={r} fav={favs.includes(r.symbol)} onOpen={() => { tap(); setOpen(r); }} />)}
        </View>
      ))}
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16 }}>
        Veri Finnhub (sunucu önbelleği). Küçük şirketler (&lt; 2 mlr $) yalnız izleme listesi veya favoriyse görünür. Bilgi amaçlıdır; tavsiye değildir.
      </Text>
    </ScrollView>
  );
}

const dayLong = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('tr-TR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

/** Sıkı satır: yıldız · sembol · EPS beklenti → gerçek · sürpriz çipi */
function CompactRow({ r, fav, onOpen }: { r: EarningsItem; fav: boolean; onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, opacity: pressed ? 0.6 : 1 })}>
      <Pressable onPress={() => { tap(); earnFavs.toggle(r.symbol); }} hitSlop={12} accessibilityRole="button" accessibilityLabel={fav ? 'Favoriden çıkar' : 'Favoriye ekle'}>
        <Text style={{ color: fav ? C.warn : C.muted, fontSize: 18, width: 22, textAlign: 'center' }}>{fav ? '★' : '☆'}</Text>
      </Pressable>
      <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', minWidth: 58, flexShrink: 0 }} numberOfLines={1}>{r.symbol}</Text>
      <Text style={{ color: C.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>
        {fmtEps(r.epsEstimate)} → <Text style={{ color: C.text }}>{fmtEps(r.epsActual)}</Text>
      </Text>
      {fmtSurprise(r.surprisePct) ? (
        <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: chipBg(r.surprisePct) }}>
          <Text style={{ color: chipFg(r.surprisePct), fontSize: 12, fontWeight: '700' }}>{fmtSurprise(r.surprisePct)}</Text>
        </View>
      ) : null}
      <Text style={{ color: C.muted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}
