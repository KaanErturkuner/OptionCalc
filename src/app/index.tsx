import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState as RNAppState, Platform, Pressable, RefreshControl, ScrollView, TextInput, Share, Switch, Text, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import * as St from '@/lib/strategy';
import type { Leg } from '@/lib/strategy';
import {
  G, STRATS, applyChain, buildLegs, fillFromQuote, clearState, defaultState, loadState, mkLeg, priceRange, priceStep, roundK, saveState, scnDate, scnWhen,
  strikeStep, stratName, type AppState, type StratId,
} from '@/lib/state';
import { expirations, etDate, etOffset, isMonthly } from '@/lib/usmarket';
import * as MD from '@/lib/market';
import ChainPicker from '@/ui/ChainPicker';
import { num, pct, shortDate, trDate, usd } from '@/lib/format';
import { Btn, Card, Chip, DateField, NumField, Seg, StepField, s, tap } from '@/ui/controls';
import { C, plColor } from '@/ui/theme';
import Chart from '@/ui/Chart';
import Heatmap from '@/ui/Heatmap';

const PCTS = [-20, -10, -5, 5, 10, 20];
const IVS = [-20, -10, -5, 0, 5, 10];
const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const dLabel = (d: string) => `${+d.slice(8, 10)} ${AY[+d.slice(5, 7) - 1]}${d.slice(0, 4) !== new Date().getFullYear().toString() ? ' ' + d.slice(2, 4) : ''}`;
const etStamp = (ms: number) => { const et = new Date(ms + etOffset(ms) * 3600000), p2 = (x: number) => String(x).padStart(2, '0'); return `${p2(et.getUTCDate())}.${p2(et.getUTCMonth() + 1)} ${p2(et.getUTCHours())}:${p2(et.getUTCMinutes())}`; };
const legName = (l: Leg) => l.kind === 'stock' ? `${l.side > 0 ? 'Long' : 'Short'} hisse` : `${l.side > 0 ? 'Long' : 'Short'} ${l.kind === 'call' ? 'Call' : 'Put'}`;

export default function Home() {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [chartW, setChartW] = useState(320);
  const [state, setState] = useState<AppState>(() => defaultState());
  const [ready, setReady] = useState(false);
  const [scrub, setScrub] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [unit, setUnit] = useState<'usd' | 'pct' | 'val'>('usd');
  const [ivNote, setIvNote] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  const [toastA] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scnY = useRef(0);
  const [chains, setChains] = useState<Record<string, MD.Chain>>({});
  const [loading, setLoading] = useState(false);
  const [mdErr, setMdErr] = useState('');
  const [picker, setPicker] = useState<number | null>(null);
  const [tick, setTick] = useState<string | null>(null);
  const stRef = useRef(state);
  const chainsRef = useRef(chains);
  useEffect(() => { stRef.current = state; chainsRef.current = chains; });

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => saveState(state), 300);
    return () => clearTimeout(t);
  }, [state, ready]);
  // Uygulamaya dönünce saati yenile (vadeye kalan süre ET kapanışına göre)
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', st => {
      if (st === 'active') setState(p => { const now = Date.now(); return { ...p, now, today: etDate(now) }; });
    });
    return () => sub.remove();
  }, []);

  const toast = useCallback((m: string) => {
    setMsg(m); toastA.setValue(0);
    Animated.sequence([Animated.timing(toastA, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(1500), Animated.timing(toastA, { toValue: 0, duration: 250, useNativeDriver: true })]).start();
  }, [toastA]);

  const up = useCallback((fn: (d: AppState) => void) => setState(prev => {
    const n: AppState = { ...prev, scn: { ...prev.scn }, legs: prev.legs.map(l => ({ ...l })) }; fn(n); return n;
  }), []);

  const g = G(state);
  const { an, gr, early } = useMemo(() => {
    const g0 = G(state);
    return {
      an: state.legs.length ? St.analyze(state.legs, g0) : null,
      gr: St.totalGreeks(state.legs, g0),
      early: state.legs.map(l => l.side < 0 && St.legEarly(l, g0)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.legs, state.S, state.r, state.q, state.now, state.divAmt, state.divDate, state.divRepeat]);
  const exps = useMemo(() => {
    if (state.src && state.marketExps.length) return state.marketExps.map(e => ({ date: e, monthly: isMonthly(e), days: St.daysBetween(state.today, e) }));
    return expirations(state.now);
  }, [state.now, state.src, state.marketExps, state.today]);
  const scnD = scnDate(state);
  const T = state.scn.target, iv = state.scn.ivShift;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const range = useMemo(() => an ? priceRange(state, an) : [0, 1] as [number, number], [an, state.S, T]);
  // Hedef kaydırıcı aralığı hedeften bağımsız (kaydırırken zıplamasın)
  const sl = useMemo(() => {
    const em = an ? Math.max(an.expectedMove * 2.5, state.S * 0.15) : state.S * 0.3;
    const ks = St.optLegs(state.legs).map(l => l.strike);
    return [Math.max(Math.min(state.S - em, ...ks.map(k => k * 0.9)), state.S * 0.02), Math.max(state.S + em, ...ks.map(k => k * 1.1))];
  }, [an, state.S, state.legs]);

  const exp = an?.expiry || state.expiry;
  const last = St.lastExpiry(state.legs, g);
  const maxD = Math.max(St.daysBetween(state.today, last), 1);
  const scnDays = St.daysBetween(state.today, scnD);
  const pb = an ? St.pctBase(an) : { base: 1, label: '' };
  const scnVal = state.legs.length ? St.value(state.legs, g, T, scnWhen(state, scnD, exp), iv) : 0;
  const scnPL = an ? scnVal - an.cost : 0;
  const custom = state.strat === 'custom';

  // ——— eylemler ———
  const setS = (x: number | null) => {
    if (x == null || !(x > 0)) return;
    up(d => {
      const ratio = d.scn.target / d.S; d.S = x;
      if (isFinite(ratio)) d.scn.target = +(x * ratio).toFixed(2);
      if (d.autoStrikes && d.strat !== 'custom') {
        d.legs = buildLegs(d.strat, x, d.expiry, d.iv, d.contracts);
        const ch = d.src ? chainsRef.current[d.expiry] : undefined; if (ch) applyChain(d, ch, 'snap');
      }
    });
  };
  const setTarget = (x: number) => up(d => { d.scn.target = +x.toFixed(2); });
  const pickStrat = (id: StratId) => up(d => {
    d.strat = id;
    if (id !== 'custom') {
      d.legs = buildLegs(id, d.S, d.expiry, d.iv, d.contracts); d.autoStrikes = true;
      const ch = d.src ? chainsRef.current[d.expiry] : undefined; if (ch) applyChain(d, ch, 'snap');
    }
    setIvNote({}); toast(stratName(id));
  });
  const pickExpiry = (e: string) => {
    up(d => {
      d.expiry = e;
      d.legs.forEach(l => { if (l.kind !== 'stock' && l.expiry !== e) { l.expiry = e; if (!l.live) l.premium = null; } });
      if (d.scn.dateMode === 'custom') d.scn.dateMode = 'exp';
    });
    if (stRef.current.src) getChain(e, 'snap');
  };

  // ——— piyasa verisi ———
  const getChain = async (e: string, mode: 'snap' | 'refresh', force = false, src = stRef.current.src, ticker = stRef.current.ticker) => {
    if (!src || !ticker) return;
    try {
      const ch = !force && chainsRef.current[e] ? chainsRef.current[e] : await MD.loadChain(src, ticker, e, stRef.current.apiKey || undefined);
      setChains(c => ({ ...c, [e]: ch }));
      up(d => { if (d.ticker === ticker) applyChain(d, ch, mode); });
    } catch (err: any) { setMdErr('Zincir alınamadı: ' + (err?.message || 'hata')); }
  };
  const fetchTicker = async (raw: string, refresh = false, silent = false) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setMdErr('');
    if (refresh) MD.clearCaches();
    try {
      const s0 = stRef.current;
      const r = await MD.loadSymbol(sym, s0.provider, s0.apiKey || undefined);
      const changed = sym !== s0.ticker || r.provider !== s0.src;
      if (changed) setChains({});
      const exp = r.expirations.includes(s0.expiry) ? s0.expiry : (MD.closestExpiry(r.expirations, s0.expiry) || s0.expiry);
      up(d => {
        const ratio = d.scn.target / d.S;
        d.ticker = sym; d.src = r.provider; d.quote = r.quote; d.marketExps = r.expirations;
        d.S = +r.quote.price.toFixed(2);
        d.scn.target = changed ? +(d.S * 1.05).toFixed(2) : +(d.S * (isFinite(ratio) ? ratio : 1)).toFixed(2);
        if (r.quote.divYield != null && !(d.divAmt > 0)) d.q = +r.quote.divYield.toFixed(2);
        d.expiry = exp;
        d.legs.forEach(l => { if (l.kind !== 'stock') l.expiry = exp; });
        if (changed && d.strat !== 'custom') d.autoStrikes = true;
        if (d.autoStrikes && d.strat !== 'custom') d.legs = buildLegs(d.strat, d.S, exp, d.iv, d.contracts);
        if (changed) d.legs.forEach(l => { if (l.kind === 'stock') l.premium = null; });
      });
      setTick(null);
      await getChain(exp, 'snap', true, r.provider, sym);
      if (!silent) toast(`${sym} ${num(r.quote.price, 2)} $ · ${r.quote.source}`);
    } catch (err: any) {
      setMdErr(`${sym}: ${err?.message || 'Veri alınamadı'}${stRef.current.quote ? ' — son alınan veriler gösteriliyor' : ' — fiyatı elle girebilirsin'}`);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    loadState().then(s0 => {
      if (s0) setState(s0); setReady(true);
      if (s0?.ticker && s0.src) setTimeout(() => fetchTicker(s0.ticker, false, true), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickContract = (i: number, o: MD.OptQuote) => {
    up(d => { d.legs[i] = fillFromQuote(d.legs[i], o, G(d)); d.autoStrikes = false; });
    setPicker(null);
  };
  const setContracts = (n: number | null) => {
    if (n == null || !(n >= 1)) return;
    const k = Math.round(n);
    up(d => {
      const old = d.contracts || 1;
      d.legs.forEach(l => { l.qty = l.kind === 'stock' ? Math.round(l.qty / old * k / 100) * 100 || 100 * k : Math.max(1, Math.round(l.qty / old * k)); });
      d.contracts = k;
    });
  };
  const setLeg = (i: number, p: Partial<Leg>) => up(d => { d.legs[i] = { ...d.legs[i], ...p }; });
  const setStrike = (i: number, k: number | null) => {
    if (k == null || !(k > 0)) return;
    up(d => { d.legs[i] = { ...d.legs[i], strike: k, premium: null }; d.autoStrikes = false; });
  };
  const setPremium = (i: number, p: number | null) => {
    const l = state.legs[i];
    if (p == null || !(p > 0)) { setLeg(i, { premium: null }); setIvNote(n => ({ ...n, [l.id!]: '' })); return; }
    const v = St.legIV(l, g, p);
    up(d => {
      d.autoStrikes = false;
      d.legs[i] = { ...d.legs[i], premium: p, ...(isFinite(v) ? { iv: +v.toFixed(2) } : {}) };
      if (isFinite(v)) d.iv = +v.toFixed(2);
    });
    setIvNote(n => ({ ...n, [l.id!]: isFinite(v) ? '' : (p < Math.max(l.kind === 'call' ? state.S - l.strike : l.strike - state.S, 0) ? 'Prim içsel değerin altında' : 'Bu primle IV çözülemedi') }));
  };
  const addLeg = (kind: Leg['kind']) => up(d => {
    d.strat = 'custom';
    d.legs.push(kind === 'stock' ? mkLeg('stock', 1, 0, d.expiry, 0, 100 * d.contracts) : mkLeg(kind, 1, roundK(d.S, d.S), d.expiry, d.iv, d.contracts));
  });

  const share = async () => {
    if (!an) return;
    const lines = [
      `📈 ${state.ticker ? state.ticker.toUpperCase() + ' ' : ''}${num(state.S, 2)} $ · ${stratName(state.strat)} · Amerikan tipi`,
      ...state.legs.map(l => l.kind === 'stock' ? `${l.side > 0 ? 'Long' : 'Short'} ${num(l.qty, 0)} hisse @ ${num(St.legEntry(l, g), 2)}`
        : `${l.side > 0 ? 'Long' : 'Short'} ${num(l.qty, 0)}× ${num(l.strike, 2)} ${l.kind === 'call' ? 'Call' : 'Put'} ${trDate(l.expiry)} @ ${num(St.legEntry(l, g), 2)} (IV %${num(l.iv, 1)})`),
      `${an.cost >= 0 ? 'Net maliyet' : 'Net alınan'}: ${usd(Math.abs(an.cost))}`,
      `Max kâr: ${usd(an.maxProfit)} · Max zarar: ${usd(an.maxLoss)}`,
      `Başabaş: ${an.breakevens.map(b => num(b, 2)).join(' · ') || '—'} · Kâr olasılığı: %${num(an.pop * 100, 1)}`,
      `Hedef: ${num(T, 2)} $ (${trDate(scnD)}) → ${usd(scnPL, 2, true)} (${pct(scnPL / pb.base)})`,
    ];
    try { await Share.share({ message: lines.join('\n') }); } catch {}
  };
  const reset = () => {
    const doIt = () => { clearState(); setState(defaultState()); setIvNote({}); toast('Sıfırlandı'); };
    if (Platform.OS === 'web') doIt();
    else Alert.alert('Sıfırla', 'Her şey varsayılana dönsün mü?', [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Sıfırla', style: 'destructive', onPress: doIt }]);
  };

  const plWord = scnPL > 0.005 ? 'Kâr' : scnPL < -0.005 ? 'Zarar' : 'Başabaş';
  const kStep = strikeStep(state.S), tStep = priceStep(state.S);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[0]}
        scrollEnabled={!scrub}
        refreshControl={state.ticker ? <RefreshControl refreshing={loading} onRefresh={() => fetchTicker(state.ticker, true)} tintColor={C.muted} /> : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: insets.bottom + 40, alignItems: 'center' }}
      >
        {/* Yapışkan üst bar: her zaman hedefteki K/Z görünür */}
        <View style={{ width: '100%', paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: 'rgba(10,15,28,.97)', borderBottomWidth: 0.5, borderBottomColor: C.border }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>📈 Opsiyon <Text style={{ color: C.muted, fontSize: 14, fontWeight: '700' }}>🇺🇸 ABD</Text></Text>
            <View style={s.row}>
              <Btn label="Paylaş" onPress={share} style={{ minHeight: 38 }} />
              <Btn label="↺" onPress={reset} style={{ minHeight: 38, paddingHorizontal: 13 }} />
            </View>
          </View>
          {an ? (
            <Pressable onPress={() => scrollRef.current?.scrollTo({ y: scnY.current, animated: true })}>
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {num(state.S, 2)} → <Text style={{ color: C.warn, fontWeight: '700' }}>{num(T, 2)} $</Text> · {shortDate(scnD)}{'  '}
                <Text style={{ color: plColor(scnPL), fontWeight: '800', fontSize: 15 }}>{usd(scnPL, 0, true)}  {pct(scnPL / pb.base)}</Text>
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ width: '100%', maxWidth: 560, paddingHorizontal: 12, paddingTop: 12 }}>
          {/* 1. Hisse */}
          <Card>
            <View style={[s.row, { alignItems: 'flex-end' }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Hisse / ETF sembolü</Text>
                <View style={s.inputWrap}>
                  <TextInput value={tick ?? state.ticker} onChangeText={v => setTick(v.toUpperCase().replace(/[^A-Z0-9.\-$]/g, ''))}
                    onFocus={() => setTick(state.ticker)} placeholder="AAPL, SPY, TSLA…" placeholderTextColor="#55617a"
                    autoCapitalize="characters" autoCorrect={false} keyboardAppearance="dark" returnKeyType="search" maxLength={10}
                    onSubmitEditing={() => fetchTicker(tick ?? state.ticker)} style={[s.input, { fontSize: 20, fontWeight: '800', letterSpacing: 1 }]} />
                </View>
              </View>
              <Pressable onPress={() => { tap(); fetchTicker(tick ?? state.ticker, tick == null || tick === state.ticker); }} disabled={loading}
                style={({ pressed }) => [st.fetch, pressed && { opacity: .6 }]} accessibilityLabel="Fiyatı getir">
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{state.src && (tick == null || tick === state.ticker) ? '↻' : 'Getir'}</Text>}
              </Pressable>
            </View>
            {state.quote && state.src ? (
              <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 8, lineHeight: 18 }}>
                {state.quote.name ? state.quote.name + ' · ' : ''}<Text style={{ color: C.text, fontWeight: '800' }}>{num(state.quote.price, 2)} $</Text>{' '}
                <Text style={{ color: plColor(state.quote.changePct), fontWeight: '700' }}>{pct(state.quote.changePct / 100, 2)}</Text>
                {'\n'}{MD.marketOpen(state.now) ? '' : 'Piyasa kapalı · '}son işlem {isFinite(state.quote.time) ? etStamp(state.quote.time) : '—'} ET · {state.quote.delayedMin ? `${state.quote.delayedMin} dk gecikmeli` : 'gerçek zamanlı'} · {state.quote.source}
                {state.quote.extPrice ? ` · seans dışı ${num(state.quote.extPrice, 2)} $` : ''}{state.quote.iv30 ? ` · IV30 %${num(state.quote.iv30, 1)}` : ''}{state.quote.divYield ? ` · temettü %${num(state.quote.divYield, 2)}` : ''}
              </Text>
            ) : (
              <Text style={[s.hint, { marginTop: 8 }]}>Sembolü yaz, Getir’e bas: fiyat, gerçek vadeler ve opsiyon zinciri (bid/ask, IV) gelir.</Text>
            )}
            {mdErr ? <Text style={{ color: C.neg, fontSize: 12.5, marginTop: 6 }}>{mdErr}</Text> : null}
            <View style={{ marginTop: 10 }}>
              <StepField label="Hisse fiyatı ($)" value={state.S} onValue={setS} step={tStep} min={tStep} digits={2} />
            </View>
          </Card>

          {/* 2. Strateji */}
          <Text style={st.section}>Strateji</Text>
          <View style={st.grid}>
            {STRATS.map(x => {
              const on = state.strat === x.id;
              return (
                <Pressable key={x.id} onPress={() => { tap(); pickStrat(x.id); }}
                  style={({ pressed }) => [st.strat, on && st.stratOn, pressed && { opacity: .6 }]}>
                  <Text style={[st.stratT, on && { color: '#fff' }]} numberOfLines={2}>{x.name}</Text>
                  <Text style={[st.stratS, on && { color: 'rgba(255,255,255,.8)' }]} numberOfLines={1}>{x.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 3. Vade */}
          <View style={[s.row, { justifyContent: 'space-between', marginTop: 4 }]}>
            <Text style={st.section}>Vade</Text>
            <Text style={{ color: C.muted, fontSize: 12.5 }}>{trDate(state.expiry)} · 16:00 ET · {Math.max(St.daysBetween(state.today, state.expiry), 0)} gün</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -12, marginBottom: 12 }}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
            {exps.map(e => {
              const on = e.date === state.expiry;
              return (
                <Pressable key={e.date} onPress={() => { tap(); pickExpiry(e.date); }}
                  style={({ pressed }) => [st.exp, on && st.stratOn, pressed && { opacity: .6 }]}>
                  <Text style={[st.expT, on && { color: '#fff' }]}>{dLabel(e.date)}</Text>
                  <Text style={[st.expS, on && { color: 'rgba(255,255,255,.85)' }, e.monthly && !on && { color: C.warn }]}>
                    {e.days === 0 ? '0DTE' : e.days + 'g'}{e.monthly ? ' · Aylık' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 4. Bacaklar */}
          <Card>
            <View style={[s.row, { marginBottom: 12, justifyContent: 'space-between' }]}>
              <Text style={[s.h2, { flexShrink: 1 }]} numberOfLines={1}>{stratName(state.strat)}</Text>
              <View style={[s.row, { width: 190 }]}>
                <Text style={{ color: C.muted, fontSize: 13 }}>Kontrat</Text>
                <StepField value={state.contracts} onValue={setContracts} step={1} min={1} digits={0} />
              </View>
            </View>
            {state.legs.map((l, i) => {
              const short = l.side < 0, col = l.kind === 'stock' ? C.muted : short ? C.neg : C.pos;
              if (l.kind === 'stock') {
                return (
                  <View key={l.id} style={[st.leg, { borderLeftColor: col }]}>
                    <View style={[s.row, { justifyContent: 'space-between' }]}>
                      <Text style={[st.legName, { color: col }]}>{num(l.qty, 0)} hisse</Text>
                      {custom ? <DelBtn onPress={() => up(d => { d.legs.splice(i, 1); })} /> : null}
                    </View>
                    <NumField label="Alış fiyatı ($) — boşsa güncel fiyat" value={l.premium} allowEmpty placeholder={num(state.S, 2)}
                      onValue={v => setLeg(i, { premium: v })} />
                  </View>
                );
              }
              const theo = St.legTheo(l, g);
              const lg = St.legGreeks(l, g), k = l.side * l.qty * 100 || 1;
              const note = ivNote[l.id!];
              return (
                <View key={l.id} style={[st.leg, { borderLeftColor: col }]}>
                  <View style={[s.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
                    {custom ? (
                      <>
                        <Seg small options={[[1, 'Long'], [-1, 'Short']]} value={l.side} onChange={v => setLeg(i, { side: v, premium: null })} style={{ flex: 1 }} />
                        <Seg small options={[['call', 'Call'], ['put', 'Put']]} value={l.kind} onChange={v => setLeg(i, { kind: v, premium: null })} style={{ flex: 1 }} />
                        <DelBtn onPress={() => up(d => { d.legs.splice(i, 1); })} />
                      </>
                    ) : (
                      <Text style={[st.legName, { color: col }]}>{legName(l)}{l.qty > 1 ? ` ×${l.qty}` : ''}</Text>
                    )}
                  </View>
                  <StepField label="Strike ($)" value={l.strike} onValue={v => setStrike(i, v)} step={kStep} min={kStep} digits={2} />
                  {chains[l.expiry] ? (() => {
                    const ch = chains[l.expiry], q = (l.kind === 'call' ? ch.calls : ch.puts).find(x => Math.abs(x.strike - l.strike) < 1e-9);
                    return (
                      <>
                        <Pressable onPress={() => { tap(); setPicker(picker === l.id ? null : l.id!); }} style={st.chainBtn}>
                          <Text style={{ color: C.blue, fontWeight: '700', fontSize: 14 }}>{picker === l.id ? 'Zinciri kapat ▲' : 'Zincirden seç ▼'}</Text>
                          {q ? <Text style={{ color: C.muted, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>
                            {num(q.bid, 2)} / {num(q.ask, 2)}{q.iv ? ` · IV %${num(q.iv * 100, 1)}` : ''}
                          </Text> : <Text style={{ color: C.warn, fontSize: 12.5 }}>bu strike listede yok</Text>}
                        </Pressable>
                        {picker === l.id ? <ChainPicker chain={ch} type={l.kind as 'call' | 'put'} strike={l.strike} spot={state.S} onPick={o => pickContract(i, o)} /> : null}
                      </>
                    );
                  })() : null}
                  <View style={[s.row, { marginTop: 10 }]}>
                    <NumField label={short ? 'Alınan prim ($/hisse)' : 'Ödenen prim ($/hisse)'} value={l.premium} allowEmpty digits={2}
                      placeholder={'teorik ' + num(theo, 2)} onValue={v => setPremium(i, v)} style={{ flex: 1.3 }} />
                    <NumField label={l.premium != null && !note ? 'IV % (primden)' : 'IV %'} value={l.iv} digits={2}
                      onValue={v => { if (v != null && v > 0) up(d => { d.legs[i] = { ...d.legs[i], iv: v }; d.iv = v; }); }} />
                  </View>
                  {note ? <Text style={{ color: C.neg, fontSize: 12.5, marginTop: 6 }}>{note}</Text> : null}
                  <Text style={st.info}>
                    Teorik <Text style={st.b}>{num(theo, 2)} $</Text>  ·  Δ <Text style={st.b}>{num(lg.delta / k, 2)}</Text>  ·  Θ <Text style={st.b}>{num(lg.theta / k, 3)}</Text>/gün
                    {early[i] ? <Text style={{ color: C.warn, fontWeight: '700' }}>{'\n'}⚠︎ Erken kullanım optimal — atanma riski yüksek</Text> : null}
                  </Text>
                </View>
              );
            })}
            {custom ? (
              <View style={s.row}>
                <Btn label="+ Call" style={{ flex: 1 }} onPress={() => addLeg('call')} />
                <Btn label="+ Put" style={{ flex: 1 }} onPress={() => addLeg('put')} />
                <Btn label="+ Hisse" style={{ flex: 1 }} onPress={() => addLeg('stock')} />
              </View>
            ) : null}
            <Text style={s.hint}>Primi yazınca IV otomatik çözülür (Amerikan model). Boş bırakırsan teorik fiyat kullanılır.</Text>
          </Card>

          {!an ? (
            <Card><Text style={s.muted}>Bir strateji seç.</Text></Card>
          ) : (
            <>
              {/* 5. Hedef → Kâr */}
              <View onLayout={e => { scnY.current = e.nativeEvent.layout.y; }}>
                <Card style={{ borderColor: C.accent, borderWidth: 1 }}>
                  <Text style={[s.h2, { marginBottom: 10 }]}>Hedef fiyat</Text>
                  <StepField value={T} onValue={x => { if (x != null && x > 0) setTarget(x); }} step={tStep} min={tStep} digits={2} big suffix="$" color={C.warn} />
                  <Slider style={{ width: '100%', height: 44, marginTop: 6 }} minimumValue={sl[0]} maximumValue={sl[1]} value={Math.min(Math.max(T, sl[0]), sl[1])}
                    minimumTrackTintColor={C.warn} maximumTrackTintColor={C.border} thumbTintColor="#fff"
                    onValueChange={v => setTarget(Math.round(v / tStep) * tStep)} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {PCTS.map(p => <Chip key={p} label={(p > 0 ? '+' : '') + p + '%'} active={Math.abs(T - state.S * (1 + p / 100)) < 0.006}
                      onPress={() => setTarget(state.S * (1 + p / 100))} />)}
                  </View>

                  {/* Büyük sonuç */}
                  <View style={{ backgroundColor: C.input, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 12, marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center' }}>
                      {state.ticker ? state.ticker + ' ' : ''}{num(state.S, 2)} $ → <Text style={{ color: C.warn, fontWeight: '700' }}>{num(T, 2)} $</Text> ({pct(T / state.S - 1)}) · {trDate(scnD)}{scnD >= exp ? ' (vade)' : ''}{iv ? ` · IV ${iv > 0 ? '+' : ''}${iv}` : ''}
                    </Text>
                    <Text style={{ color: plColor(scnPL), fontSize: 17, fontWeight: '800', marginTop: 6 }}>{plWord}</Text>
                    <Text style={{ color: plColor(scnPL), fontSize: 50, fontWeight: '900', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{usd(scnPL, 2, true)}</Text>
                    <Text style={{ color: plColor(scnPL), fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{pct(scnPL / pb.base)}</Text>
                    <Text style={{ color: C.muted, fontSize: 12, marginTop: 6, textAlign: 'center' }}>% {pb.label} ({usd(pb.base, 0)})</Text>
                  </View>

                  {/* Tarih */}
                  <View style={[s.row, { marginTop: 16, justifyContent: 'space-between' }]}>
                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>Tarih</Text>
                    <Text style={{ color: C.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                      {trDate(scnD)} · {scnDays === 0 ? 'bugün' : `${scnDays} gün sonra`}{scnD < exp ? ` · vadeye ${St.daysBetween(scnD, exp)} gün` : ''}
                    </Text>
                  </View>
                  <Seg style={{ marginTop: 8 }} value={state.scn.dateMode === 'custom' ? null : state.scn.dateMode}
                    options={[['today', 'Bugün'], ['mid', 'Yarı yol'], ['exp', 'Vadede']]} onChange={m => up(d => { d.scn.dateMode = m; })} />
                  <Slider style={{ width: '100%', height: 44, marginTop: 4 }} minimumValue={0} maximumValue={maxD} step={1} value={scnDays}
                    minimumTrackTintColor={C.accent} maximumTrackTintColor={C.border} thumbTintColor="#fff"
                    onValueChange={v => up(d => { d.scn.dateMode = 'custom'; d.scn.date = St.addDays(d.today, Math.round(v)); })} />

                  {/* IV değişimi */}
                  <View style={[s.row, { justifyContent: 'space-between' }]}>
                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>IV değişimi</Text>
                    <Text style={{ color: iv ? C.warn : C.muted, fontSize: 13 }}>{iv ? `${iv > 0 ? '+' : ''}${iv} puan` : 'yok'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {IVS.map(v => <Chip key={v} label={v === 0 ? '0' : (v > 0 ? '+' : '') + v} active={iv === v} onPress={() => up(d => { d.scn.ivShift = v; })} />)}
                  </View>
                </Card>
              </View>

              {/* 6. Özet */}
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Big k="Max kâr" v={usd(an.maxProfit, 0)} sub={isFinite(an.maxProfit) ? pct(an.maxProfit / pb.base, 0) : 'yukarı yönde'} color={C.pos} />
                  <Big k="Max zarar" v={usd(an.maxLoss, 0)} sub={isFinite(an.maxLoss) ? (an.sameExp ? pct(an.maxLoss / pb.base, 0) : 'ilk vadede, yaklaşık') : 'yukarı yönde'} color={C.neg} />
                  <Big k="Başabaş" v={an.breakevens.length ? an.breakevens.map(b => num(b, 2)).join(' / ') : '—'}
                    sub={an.breakevens.map(b => pct(b / state.S - 1)).join(' / ') || 'sıfırı kesmiyor'} />
                  <Big k="Kâr olasılığı" v={'%' + num(an.pop * 100, 0)} sub={`±1σ ${num(an.expectedMove, 2)} $`} color={C.blue} />
                </View>
                <Text style={{ color: C.muted, fontSize: 13, marginTop: 10, fontVariant: ['tabular-nums'] }}>
                  {an.cost >= 0 ? 'Net ödenen' : 'Net alınan'} <Text style={st.b}>{usd(Math.abs(an.cost))}</Text>
                  {'   '}Δ <Text style={st.b}>{num(gr.delta, 1)}</Text>
                  {'   '}Θ <Text style={[st.b, { color: plColor(gr.theta) }]}>{usd(gr.theta, 2, true)}</Text>/gün
                  {'   '}Vega <Text style={st.b}>{usd(gr.vega, 2, true)}</Text>
                </Text>
              </Card>

              {/* 7. Grafik */}
              <Card title="Kâr/Zarar grafiği">
                <View onLayout={e => setChartW(Math.round(e.nativeEvent.layout.width))} />
                <Chart state={state} an={an} width={Math.min(chartW, Math.min(winW, 560) - 52)} range={range} scnD={scnD}
                  onScrubbing={setScrub} onPickTarget={x => setTarget(x)} />
                <View style={[s.row, { marginTop: 6, flexWrap: 'wrap' }]}>
                  <Legend color={C.text} label="Vadede" />
                  <Legend color={C.blue} label={scnD >= an.expiry && !iv ? 'Seçilen tarih (= vade)' : `${shortDate(scnD)}${iv ? ` (IV ${iv > 0 ? '+' : ''}${iv})` : ''}`} />
                  <Legend color={C.warn} label="Başabaş / hedef" />
                </View>
              </Card>

              {/* 8. Tablo (isteğe bağlı) */}
              <Btn label={showTable ? 'Fiyat × Tarih tablosunu gizle' : 'Fiyat × Tarih tablosu'} onPress={() => setShowTable(v => !v)} style={{ marginBottom: 12 }} />
              {showTable ? (
                <Card right={<Seg small options={[['usd', '$'], ['pct', '%'], ['val', 'Değer']]} value={unit} onChange={setUnit} style={{ width: 150 }} />} title="Fiyat × Tarih">
                  <Heatmap state={state} an={an} range={range} scnD={scnD} unit={unit} onPick={(S0, dt) => {
                    up(d => { d.scn.target = +S0.toFixed(2); d.scn.dateMode = 'custom'; d.scn.date = dt; });
                    scrollRef.current?.scrollTo({ y: scnY.current, animated: true });
                  }} />
                </Card>
              ) : null}
            </>
          )}

          {/* 9. Ayarlar */}
          <Pressable onPress={() => { tap(); setShowSettings(v => !v); }} style={[s.card, s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>⚙︎ Faiz, temettü, veri</Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>
              Faiz %{num(state.r, 2)} · {state.divAmt > 0 && state.divDate ? `Temettü ${num(state.divAmt, 2)} $` : state.q > 0 ? `Temettü %${num(state.q, 2)}` : 'Temettü yok'} {showSettings ? '▲' : '▼'}
            </Text>
          </Pressable>
          {showSettings ? (
            <Card>
              <View style={s.row}>
                <NumField label="Risksiz faiz % (3A T-bill)" value={state.r} digits={3} onValue={x => { if (x != null && isFinite(x)) up(d => { d.r = x; }); }} />
                <NumField label="Temettü verimi % (sürekli)" value={state.q} digits={3} onValue={x => { if (x != null && x >= 0) up(d => { d.q = x; }); }} />
              </View>
              <Text style={[s.label, { marginTop: 14 }]}>Nakit temettü (erken kullanım için önemli)</Text>
              <View style={[s.row, { alignItems: 'flex-end' }]}>
                <NumField label="Hisse başı $" value={state.divAmt || null} allowEmpty digits={4} placeholder="0,00"
                  onValue={x => up(d => { d.divAmt = x != null && x > 0 ? x : 0; if (d.divAmt > 0 && !d.divDate) d.divDate = St.addDays(d.today, 30); })} />
                <DateField label="Sonraki ex-tarih" value={state.divDate || St.addDays(state.today, 30)} onValue={t => up(d => { d.divDate = t; })} flex={1.2} />
              </View>
              <View style={[s.row, { justifyContent: 'space-between', marginTop: 10 }]}>
                <Text style={{ color: C.text, fontSize: 14 }}>Her çeyrek tekrarla (~91 gün)</Text>
                <Switch value={state.divRepeat} onValueChange={v => up(d => { d.divRepeat = v; })} />
              </View>
              <Text style={[s.label, { marginTop: 16 }]}>Veri kaynağı</Text>
              <Seg small value={state.provider} onChange={v => up(d => { d.provider = v; })}
                options={[['auto', 'Otomatik'], ['cboe', 'CBOE'], ['yahoo', 'Yahoo'], ['tradier', 'Tradier']]} />
              {state.provider === 'tradier' || state.apiKey ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={s.label}>Tradier API anahtarı (gerçek zamanlı; Otomatik modda önce bu denenir)</Text>
                  <View style={s.inputWrap}>
                    <TextInput value={state.apiKey} onChangeText={v => up(d => { d.apiKey = v.trim(); })} secureTextEntry autoCapitalize="none" autoCorrect={false}
                      placeholder="Bearer token" placeholderTextColor="#55617a" keyboardAppearance="dark" style={s.input} />
                  </View>
                </View>
              ) : null}
              <Text style={s.hint}>Otomatik: CBOE (anahtarsız, ~15 dk gecikmeli, bid/ask + IV + Greek) → olmazsa Yahoo. Veri 60 sn önbellekte tutulur; aşağı çekerek yenile.</Text>
              <Text style={s.hint}>Nakit temettü varsa sürekli verimi 0 bırak. Covered call / short call’da ex-tarih öncesi erken atanma riski bu bilgiyle hesaplanır.</Text>
            </Card>
          ) : null}

          <Text style={[s.hint, { textAlign: 'center', paddingHorizontal: 8 }]}>
            ABD hisse/ETF opsiyonları · Amerikan tipi (erken kullanım dahil): Leisen-Reimer binom ağacı + Richardson, nakit temettü destekli.
            Süre 16:00 ET kapanışına göre (takvim günü/365). Kontrat = 100 hisse. Komisyon ve bid/ask dahil değil. Yatırım tavsiyesi değildir.
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

function Big({ k, v, sub, color }: { k: string; v: string; sub?: string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statK} numberOfLines={1}>{k}</Text>
      <Text style={[s.statV, { fontVariant: ['tabular-nums'] }, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
      {sub ? <Text style={s.statS} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}
function DelBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} hitSlop={8} style={st.del} accessibilityLabel="Bacağı sil">
      <Text style={{ color: C.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
    </Pressable>
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

const st = {
  section: { color: C.muted, fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.5, marginBottom: 8, marginLeft: 4, textTransform: 'uppercase' as const },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 14 },
  strat: { width: '31.6%' as const, flexGrow: 1, minHeight: 64, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9, justifyContent: 'center' as const,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  stratOn: { backgroundColor: C.accent, borderColor: C.accent },
  stratT: { color: C.text, fontWeight: '800' as const, fontSize: 14, lineHeight: 17 },
  stratS: { color: C.muted, fontSize: 11.5, marginTop: 2 },
  exp: { minWidth: 76, minHeight: 56, borderRadius: 14, paddingHorizontal: 12, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  expT: { color: C.text, fontWeight: '800' as const, fontSize: 15 },
  expS: { color: C.muted, fontSize: 11.5, marginTop: 2 },
  leg: { backgroundColor: C.card2, borderRadius: 14, padding: 12, marginBottom: 10, borderLeftWidth: 4 },
  legName: { fontWeight: '800' as const, fontSize: 16 },
  fetch: { minWidth: 76, height: 46, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.accent, paddingHorizontal: 14 },
  chainBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, minHeight: 40, marginTop: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.input },
  del: { width: 42, height: 42, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.input },
  info: { color: C.muted, fontSize: 12.5, marginTop: 8 },
  b: { color: C.text, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
};
