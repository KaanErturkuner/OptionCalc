import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Platform, ScrollView, Share, Text, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import * as St from '@/lib/strategy';
import type { Leg } from '@/lib/strategy';
import { G, PRESETS, clearState, defaultState, loadState, mkLeg, priceRange, roundK, saveState, scnDate, type AppState } from '@/lib/state';
import { num, pct, shortDate, trDate, usd } from '@/lib/format';
import { Btn, Card, Chip, NumField, Seg, Stat, TextField, s } from '@/ui/controls';
import { C, plColor } from '@/ui/theme';
import Chart from '@/ui/Chart';
import Heatmap from '@/ui/Heatmap';
import LegCard, { DateField } from '@/ui/LegCard';

const PCTS = [-20, -10, -5, -2, 0, 2, 5, 10, 20];
const RANGES: [number, string][] = [[0, 'Oto'], [10, '±10'], [20, '±20'], [35, '±35'], [50, '±50']];

export default function Home() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [chartW, setChartW] = useState(Math.min(width, 520) - 52);
  const [state, setState] = useState<AppState>(defaultState);
  const [ready, setReady] = useState(false);
  const [scrub, setScrub] = useState(false);
  const [msg, setMsg] = useState('');
  const [toastA] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scnY = useRef(0);

  useEffect(() => { loadState().then(s0 => { if (s0) setState(s0); setReady(true); }); }, []);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveState(state), 300);
    return () => clearTimeout(t);
  }, [state, ready]);

  const toast = useCallback((m: string) => {
    setMsg(m); toastA.setValue(0);
    Animated.sequence([Animated.timing(toastA, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(1500), Animated.timing(toastA, { toValue: 0, duration: 250, useNativeDriver: true })]).start();
  }, [toastA]);

  const up = useCallback((fn: (d: AppState) => void) => setState(prev => {
    const n: AppState = { ...prev, scn: { ...prev.scn }, legs: prev.legs.map(l => ({ ...l })) }; fn(n); return n;
  }), []);

  const g = G(state);
  const hasLegs = state.legs.length > 0;
  const an = useMemo(() => hasLegs ? St.analyze(state.legs, G(state)) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.legs, state.S, state.r, state.q, state.today]);
  const gr = useMemo(() => St.totalGreeks(state.legs, G(state)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.legs, state.S, state.r, state.q, state.today]);
  const scnD = scnDate(state);
  const range = useMemo(() => an ? priceRange(state, an) : [0, 1] as [number, number],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [an, state.range, state.S, state.scn.target, state.legs]);

  const lastExp = St.lastExpiry(state.legs, g);
  const maxD = Math.max(St.daysBetween(state.today, lastExp), 1);
  const scnDays = St.daysBetween(state.today, scnD);
  const T = state.scn.target, iv = state.scn.ivShift;
  const pb = an ? St.pctBase(an) : { base: 1, label: '' };
  const scnVal = hasLegs ? St.value(state.legs, g, T, scnD, iv) : 0;
  const scnPL = an ? scnVal - an.cost : 0;

  const setS = (x: number | null) => { if (x == null || !(x > 0)) return; up(d => { const ratio = d.scn.target / d.S; d.S = x; if (isFinite(ratio)) d.scn.target = +(x * ratio).toFixed(2); }); };
  const setTarget = (x: number) => up(d => { d.scn.target = x; });
  const loadPreset = (name: string, fn: (S: number, e: string, v: number) => Leg[]) => up(d => {
    const o = St.optLegs(d.legs), e = o.length ? o[0].expiry : St.addDays(d.today, 30), v = o.length ? o[0].iv : 30;
    d.legs = fn(d.S, e, v); toast(name + ' yüklendi');
  });
  const share = async () => {
    if (!an) return;
    const lines = [
      `📈 ${state.ticker ? state.ticker.toUpperCase() + ' ' : ''}${num(state.S, 2)} $`,
      ...state.legs.map(l => l.kind === 'stock' ? `${l.side > 0 ? 'Long' : 'Short'} ${num(l.qty, 0)} hisse @ ${num(St.legEntry(l, g), 2)}`
        : `${l.side > 0 ? 'Long' : 'Short'} ${num(l.qty, 0)}× ${num(l.strike, 2)} ${l.kind === 'call' ? 'Call' : 'Put'} ${trDate(l.expiry)} @ ${num(St.legEntry(l, g), 2)} (IV %${num(l.iv, 1)})`),
      `${an.cost >= 0 ? 'Net maliyet' : 'Net alınan'}: ${usd(Math.abs(an.cost))}`,
      `Max kâr: ${usd(an.maxProfit)} · Max zarar: ${usd(an.maxLoss)}`,
      `Başabaş: ${an.breakevens.map(b => num(b, 2)).join(' · ') || '—'} · Kâr olasılığı: %${num(an.pop * 100, 1)}`,
      `Senaryo: ${num(T, 2)} $ (${trDate(scnD)}) → ${usd(scnPL, 2, true)} (${pct(scnPL / pb.base)})`,
    ];
    try { await Share.share({ message: lines.join('\n') }); } catch {}
  };
  const reset = () => {
    const doIt = () => { clearState(); setState(defaultState()); toast('Sıfırlandı'); };
    if (Platform.OS === 'web') doIt();
    else Alert.alert('Sıfırla', 'Her şey varsayılana dönsün mü?', [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Sıfırla', style: 'destructive', onPress: doIt }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[0]}
        scrollEnabled={!scrub}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: insets.bottom + 40, alignItems: 'center' }}
      >
        {/* Yapışkan üst bar: Dynamic Island'ın altında */}
        <View style={{ width: '100%', paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: 'rgba(10,15,28,.97)', borderBottomWidth: 0.5, borderBottomColor: C.border }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>📈 Opsiyon</Text>
            <View style={s.row}>
              <Btn label="Paylaş" onPress={share} style={{ minHeight: 36 }} />
              <Btn label="↺" onPress={reset} style={{ minHeight: 36, paddingHorizontal: 12 }} />
            </View>
          </View>
          {an ? (
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
              {num(state.S, 2)} → <Text style={{ color: C.warn, fontWeight: '700' }}>{num(T, 2)} $</Text> · {shortDate(scnD)}{'  '}
              <Text style={{ color: plColor(scnPL), fontWeight: '800', fontSize: 15 }}>{usd(scnPL, 0, true)}  {pct(scnPL / pb.base)}</Text>
            </Text>
          ) : null}
        </View>

        <View style={{ width: '100%', maxWidth: 520, paddingHorizontal: 12, paddingTop: 12 }}>
          {/* 1. Hisse */}
          <Card title="Hisse" step={1}>
            <View style={s.row}>
              <TextField label="Ticker" value={state.ticker} onChange={v => up(d => { d.ticker = v; })} placeholder="AAPL" />
              <NumField label="Hisse fiyatı" value={state.S} onValue={setS} suffix="$" style={{ flex: 1.3 }} />
            </View>
            <View style={[s.row, { marginTop: 10 }]}>
              <NumField label="Faiz %" value={state.r} onValue={x => { if (x != null && isFinite(x)) up(d => { d.r = x; }); }} />
              <NumField label="Temettü %" value={state.q} onValue={x => { if (x != null && x >= 0) up(d => { d.q = x; }); }} />
              <DateField label="Bugün" value={state.today} onValue={t => up(d => { d.today = t; })} flex={1.3} />
            </View>
          </Card>

          {/* 2. Strateji */}
          <Card title="Strateji" step={2}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -14, marginBottom: 12 }}
              contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}>
              {PRESETS.map(([name, fn]) => <Chip key={name} label={name} onPress={() => loadPreset(name, fn)} />)}
            </ScrollView>
            {state.legs.map((l, i) => (
              <LegCard key={l.id} leg={l} g={g} toast={toast}
                onChange={nl => up(d => { d.legs[i] = nl; })}
                onDelete={() => up(d => { d.legs.splice(i, 1); })} />
            ))}
            <View style={s.row}>
              <Btn label="+ Opsiyon" style={{ flex: 1 }} onPress={() => up(d => {
                const o = St.optLegs(d.legs);
                d.legs.push(mkLeg('call', 1, roundK(d.S, d.S), o.length ? o[0].expiry : St.addDays(d.today, 30), o.length ? o[0].iv : 30));
              })} />
              <Btn label="+ Hisse" style={{ flex: 1 }} onPress={() => up(d => { d.legs.push(mkLeg('stock', 1, 0, St.addDays(d.today, 30), 0, 100, null)); })} />
            </View>
            <Text style={s.hint}>Prim boşsa teorik fiyat kullanılır. Gerçek dolum fiyatını yazarsan K/Z ona göre hesaplanır; <Text style={{ color: C.text, fontWeight: '700' }}>IV ← prim</Text> o fiyattan implied volatility çözer.</Text>
          </Card>

          {!an ? (
            <Card><Text style={s.muted}>Bir strateji seç veya bacak ekle.</Text></Card>
          ) : (
            <>
              {/* Özet */}
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Stat k={an.cost >= 0 ? 'Net maliyet (debit)' : 'Net alınan (credit)'} v={usd(Math.abs(an.cost))}
                    sub={`${state.ticker ? state.ticker.toUpperCase() + ' · ' : ''}vade ${trDate(an.expiry)} (${St.daysBetween(state.today, an.expiry)} gün)`} />
                  <Stat k="Kâr olasılığı" v={num(an.pop * 100, 1) + '%'} sub={`±1σ: ${num(an.expectedMove, 2)} $ (${num(an.expectedMove / state.S * 100, 1)}%)`} color={C.blue} />
                  <Stat k="Max kâr" v={usd(an.maxProfit)} color={C.pos}
                    sub={isFinite(an.maxProfit) ? pct(an.maxProfit / pb.base, 0) + ' getiri' : 'yukarı yönde sınırsız'} />
                  <Stat k="Max zarar" v={usd(an.maxLoss)} color={C.neg} sub={an.sameExp ? 'vadede' : 'ilk vadede (yaklaşık)'} />
                  <View style={[s.stat, { width: '100%' }]}>
                    <Text style={s.statK}>Başabaş</Text>
                    <Text style={[s.statV, { fontSize: 19 }]}>{an.breakevens.length ? an.breakevens.map(b => num(b, 2) + ' $').join('  ·  ') : '—'}</Text>
                    <Text style={s.statS}>{an.breakevens.length ? an.breakevens.map(b => pct(b / state.S - 1)).join('  ·  ') : 'hiç sıfırı kesmiyor'}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 12 }}>
                  <GreekT k="Delta" v={num(gr.delta, 1)} unit="hisse" c={plColor(gr.delta)} />
                  <GreekT k="Gamma" v={num(gr.gamma, 2)} />
                  <GreekT k="Theta" v={usd(gr.theta, 2, true)} unit="/gün" c={plColor(gr.theta)} />
                  <GreekT k="Vega" v={usd(gr.vega, 2, true)} unit="/IV puanı" c={plColor(gr.vega)} />
                  <GreekT k="Rho" v={usd(gr.rho, 2, true)} unit="/faiz puanı" />
                </View>
                <Text style={[s.hint, { marginTop: 6 }]}>% hesap tabanı: {pb.label} ({usd(pb.base)})</Text>
              </Card>

              {/* 3. Senaryo */}
              <View onLayout={e => { scnY.current = e.nativeEvent.layout.y; }}>
                <Card title="Senaryo: nereye gelirse ne kazanırım?" step={3} style={{ borderColor: C.accent, borderWidth: 1 }}>
                  <View style={[s.row, { alignItems: 'flex-end' }]}>
                    <View style={{ paddingBottom: 16 }}><Text style={{ color: C.muted, fontSize: 16, fontVariant: ['tabular-nums'] }}>{num(state.S, 2)} →</Text></View>
                    <NumField label="Hedef fiyat" value={T} big suffix="$" digits={2} style={{ flex: 1.5 }}
                      onValue={x => { if (x != null && x > 0) setTarget(x); }} />
                    <NumField label="Değişim" value={+((T / state.S - 1) * 100).toFixed(1)} big suffix="%" digits={1} keyboard="numbers-and-punctuation"
                      onValue={x => { if (x != null && x > -100) setTarget(+(state.S * (1 + x / 100)).toFixed(2)); }} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {PCTS.map(p => <Chip key={p} label={(p > 0 ? '+' : '') + p + '%'} active={Math.abs(T - state.S * (1 + p / 100)) < 0.006}
                      onPress={() => setTarget(+(state.S * (1 + p / 100)).toFixed(2))} />)}
                  </View>

                  {/* Büyük sonuç */}
                  <View style={{ backgroundColor: C.input, borderRadius: 16, padding: 16, marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center' }}>
                      {state.ticker ? state.ticker.toUpperCase() + ' ' : ''}{num(state.S, 2)} $ → <Text style={{ color: C.text, fontWeight: '700' }}>{num(T, 2)} $</Text> ({pct(T / state.S - 1)}) · {trDate(scnD)}{iv ? ` · IV ${iv > 0 ? '+' : ''}${iv}` : ''}
                    </Text>
                    <Text style={{ color: plColor(scnPL), fontSize: 46, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{usd(scnPL, 2, true)}</Text>
                    <Text style={{ color: plColor(scnPL), fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{pct(scnPL / pb.base)}</Text>
                    <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
                      Pozisyon değeri <Text style={{ color: C.text, fontWeight: '700' }}>{usd(scnVal)}</Text> · {an.cost >= 0 ? 'Maliyet' : 'Alınan prim'} <Text style={{ color: C.text, fontWeight: '700' }}>{usd(Math.abs(an.cost))}</Text>{'\n'}% {pb.label}
                    </Text>
                  </View>

                  {/* Tarih */}
                  <View style={[s.row, { marginTop: 16, justifyContent: 'space-between' }]}>
                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>Tarih</Text>
                    <Text style={{ color: C.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                      {trDate(scnD)} · {scnDays === 0 ? 'bugün' : `${scnDays} gün sonra · vadeye ${St.daysBetween(scnD, an.expiry)} gün`}
                    </Text>
                  </View>
                  <Seg small style={{ marginTop: 8 }} value={state.scn.dateMode === 'custom' ? null : state.scn.dateMode}
                    options={[['today', 'Bugün'], ['mid', 'Yarı yol'], ['exp', 'Vade']]} onChange={m => up(d => { d.scn.dateMode = m; })} />
                  <Slider style={{ height: 44, marginTop: 4 }} minimumValue={0} maximumValue={maxD} step={1} value={scnDays}
                    minimumTrackTintColor={C.accent} maximumTrackTintColor={C.border} thumbTintColor="#fff"
                    onValueChange={v => up(d => { d.scn.dateMode = 'custom'; d.scn.date = St.addDays(d.today, Math.round(v)); })} />

                  {/* IV */}
                  <View style={[s.row, { justifyContent: 'space-between', marginTop: 4 }]}>
                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>IV değişimi</Text>
                    <View style={s.row}>
                      <Text style={{ color: iv ? C.warn : C.muted, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] }}>{(iv > 0 ? '+' : '') + iv} puan</Text>
                      {iv ? <Chip label="0" onPress={() => up(d => { d.scn.ivShift = 0; })} /> : null}
                    </View>
                  </View>
                  <Slider style={{ height: 44 }} minimumValue={-50} maximumValue={50} step={1} value={iv}
                    minimumTrackTintColor={C.warn} maximumTrackTintColor={C.border} thumbTintColor="#fff"
                    onValueChange={v => up(d => { d.scn.ivShift = Math.round(v); })} />

                  {/* Bacak bazında */}
                  <View style={{ marginTop: 6, gap: 4 }}>
                    {state.legs.map(l => {
                      const v = St.legValue(l, g, T, scnD, iv), e = St.legEntry(l, g), m = St.mult(l) * l.qty * l.side;
                      const name = l.kind === 'stock' ? `${l.side > 0 ? 'Long' : 'Short'} ${num(l.qty, 0)} hisse`
                        : `${l.side > 0 ? 'Long' : 'Short'} ${num(l.qty, 0)}× ${num(l.strike, 2)} ${l.kind === 'call' ? 'Call' : 'Put'} ${shortDate(l.expiry)}`;
                      return (
                        <Text key={l.id} style={{ color: C.muted, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
                          {name}: {num(e, 2)} → <Text style={{ color: C.text, fontWeight: '700' }}>{num(v, 2)} $</Text>  <Text style={{ color: plColor((v - e) * m), fontWeight: '700' }}>{usd((v - e) * m, 0, true)}</Text>
                        </Text>
                      );
                    })}
                  </View>
                </Card>
              </View>

              {/* 4. Grafik */}
              <Card title="Kâr/Zarar grafiği" step={4}>
                <Seg small options={RANGES} value={state.range} onChange={v => up(d => { d.range = v; })} />
                <View onLayout={e => setChartW(Math.round(e.nativeEvent.layout.width))} />
                <Chart state={state} an={an} width={chartW} range={range} scnD={scnD}
                  onScrubbing={setScrub} onPickTarget={x => setTarget(x)} />
                <View style={[s.row, { marginTop: 6, flexWrap: 'wrap' }]}>
                  <Legend color={C.text} label="Vadede" />
                  <Legend color={C.blue} label={scnD === an.expiry && !iv ? 'Seçilen tarih (= vade)' : `${shortDate(scnD)}${iv ? ` (IV ${iv > 0 ? '+' : ''}${iv})` : ''}`} />
                  <Legend color={C.warn} label="Başabaş / hedef" />
                </View>
                <Text style={s.hint}>Gri bant ±1σ beklenen hareket.</Text>
              </Card>

              {/* 5. Tablo */}
              <Card title="Fiyat × Tarih" step={5}
                right={<Seg small options={[['usd', '$'], ['pct', '%'], ['val', 'Değer']]} value={state.unit} onChange={v => up(d => { d.unit = v; })} style={{ width: 150 }} />}>
                <Heatmap state={state} an={an} range={range} scnD={scnD} onPick={(S, dt) => {
                  up(d => { d.scn.target = +S.toFixed(2); d.scn.dateMode = 'custom'; d.scn.date = dt; });
                  scrollRef.current?.scrollTo({ y: scnY.current, animated: true });
                }} />
                <Text style={s.hint}>Hücreye dokun: senaryo o fiyat ve tarihe ayarlanır. Seçili IV değişimi tabloya da uygulanır.</Text>
              </Card>
            </>
          )}

          <Text style={[s.hint, { textAlign: 'center', paddingHorizontal: 8 }]}>
            Black-Scholes-Merton (Avrupa tipi) teorik değerler; Amerikan tipi erken kullanım, bid/ask farkı ve komisyon dahil değildir. Yatırım tavsiyesi değildir.
            Tarihler takvim günü/365. Theta = günlük, Vega = IV +1 puan, Rho = faiz +1 puan. Değerler pozisyon bazında (kontrat × 100).
          </Text>
        </View>
      </ScrollView>

      <Animated.View pointerEvents="none" style={{
        position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center', backgroundColor: '#1e293b', paddingHorizontal: 18, paddingVertical: 12,
        borderRadius: 22, borderWidth: 1, borderColor: C.border, opacity: toastA,
        transform: [{ translateY: toastA.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}>
        <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{msg}</Text>
      </Animated.View>
    </View>
  );
}

function GreekT({ k, v, unit, c }: { k: string; v: string; unit?: string; c?: string }) {
  return (
    <Text style={{ color: C.muted, fontSize: 13 }}>
      {k} <Text style={{ color: c || C.text, fontWeight: '800', fontSize: 15, fontVariant: ['tabular-nums'] }}>{v}</Text>{unit ? ' ' + unit : ''}
    </Text>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={[s.row, { gap: 5, marginRight: 8 }]}>
      <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
