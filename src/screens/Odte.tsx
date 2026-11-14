import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadState } from '@/lib/state';
import { etToIst, istHM, marketOpen } from '@/lib/usmarket';
import { scanOne, creditsPerRefresh, type ScanItem } from '@/lib/odte/scan';
import { outcome, signalText, DEFAULT_OPTS, type Signal } from '@/lib/odte/signal';
import { newId } from '@/lib/journal';
import { journal, useJournal } from '@/ui/journalStore';
import { FreshnessPill } from '@/ui/FreshnessPill';
import { nextRefresh, setExpected } from '@/lib/freshness';
import { Btn, Card, Chip, NumField, Seg, StepField, s, tap } from '@/ui/controls';
import { ensurePermission, notifySignal, permissionStatus, scheduleExit, testNotification } from '@/ui/notify';
import { checkAlerts, DEF_NOTIF, loadNotifCfg, saveNotifCfg, syncBackgroundTask, type NotifCfg } from '@/ui/monitor';
import { exitAtMs, localHM, MAX_SIGNALS_PER_DAY, signalAllowed } from '@/lib/alerts';
import { C, plColor } from '@/ui/theme';
import VerdictBlock from '@/ui/VerdictCard';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { flowKeyOf } from '@/lib/flow/client';

export const DEFAULT_WATCH = ['QQQ', 'MU', 'AXTI', 'AAOI', 'MRVL', 'GLW', 'NBIS', 'CRWV', 'DRAM', 'AMD', 'INTC', 'SPCX', 'NVDA', 'TSLA', 'RKLB'];
export const EXTRAS = ['SPY', 'IWM', 'GLD', 'SLV'];
const KEY = 'odte-v1';
interface Cfg { watch: string[]; extras: string[]; auto: boolean; interval: number; orMin: 15 | 30; strikeLimit: number }
const DEF: Cfg = { watch: DEFAULT_WATCH, extras: [], auto: true, interval: 5, orMin: 15, strikeLimit: 30 };
const trHM = (ms: number) => istHM(ms) + ' TR';
const f2 = (x: number | null | undefined) => x == null || !isFinite(x) ? '—' : x.toFixed(2);
const dteLabel = (dte?: number) => dte == null ? '' : dte === 0 ? '0DTE' : `${dte}DTE`;

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>, each: (r: R) => void) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]; each(await f(x)); } }));
}

export default function Odte({ active, onJournal }: { active: boolean; onJournal: () => void }) {
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<Cfg>(DEF);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Record<string, ScanItem>>({});
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [hasMd, setHasMd] = useState(false);
  const [add, setAdd] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(false);
  const cfgRef = useRef(cfg);
  const [nc, setNc] = useState<NotifCfg>(DEF_NOTIF);
  const [perm, setPerm] = useState<string>('');
  const [bgInfo, setBgInfo] = useState('');
  const ncRef = useRef(nc);
  useEffect(() => { cfgRef.current = cfg; ncRef.current = nc; });
  useEffect(() => { loadNotifCfg().then(setNc); permissionStatus().then(setPerm); }, []);
  const setNotif = (p: Partial<NotifCfg>) => setNc(c => { const n = { ...c, ...p }; saveNotifCfg(n).then(() => syncBackgroundTask().then(setBgInfo)); return n; });
  // İlk kez 0DTE açılınca bildirim izni iste (Türkçe açıklamayla, bir kez)
  useEffect(() => {
    if (!active) return;
    let gone = false;
    const t = setTimeout(async () => { if (gone) return; if (ncRef.current.signals || ncRef.current.positions) await ensurePermission(); if (!gone) { setPerm(await permissionStatus()); setBgInfo(await syncBackgroundTask()); } }, 600);
    return () => { gone = true; clearTimeout(t); };
  }, [active]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(r => { if (r) try { setCfg({ ...DEF, ...JSON.parse(r) }); } catch { /* varsayılan */ } }).finally(() => setReady(true));
  }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(KEY, JSON.stringify(cfg)).catch(() => {}); }, [cfg, ready]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const c = cfgRef.current, list = [...c.watch, ...c.extras.filter(x => !c.watch.includes(x))];
    const st = await loadState(); const mdKey = flowKeyOf(st?.flowKey) || undefined; setHasMd(!!mdKey);
    const opts = { ...DEFAULT_OPTS, orMinutes: c.orMin };
    await pool(list, 3, sym => scanOne(sym, { marketdata: mdKey, tradier: st?.apiKey || undefined }, opts, c.strikeLimit), it0 => {
      // Günlük sınır: sembol başına günde en fazla 2 farklı sinyal (kontrat)
      let it = it0;
      const s0 = it0.result?.signal;
      if (s0 && !signalAllowed(journal.get().signals, s0, MAX_SIGNALS_PER_DAY))
        it = { ...it0, result: { ...it0.result!, signal: null, noSignal: `Günlük sınır: ${s0.ticker} için bugün ${MAX_SIGNALS_PER_DAY} sinyal verildi (yeni: ${s0.strike}${s0.dir === 'call' ? 'C' : 'P'} gösterilmedi)` } };
      setItems(p => ({ ...p, [it.ticker]: it }));
      const sg = it.result?.signal;
      if (sg && ncRef.current.signals) notifySignal(sg).catch(() => {});
      // aldığın pozisyonlar: dayanak fiyatıyla hedef/stop uyarısı
      if (it.ok && it.price != null) checkAlerts(Object.fromEntries(journal.get().trades.filter(t => t.ticker === it.ticker).map(t => [t.id, { und: it.price }])), t => t.ticker === it.ticker).catch(() => {});
      if (sg) journal.addSignal({ id: newId(), ticker: sg.ticker, dir: sg.dir, strike: sg.strike, expiry: sg.expiry, dte: sg.dte, entry: sg.entry, target: sg.target, stop: sg.stop,
        undTarget: sg.undTarget, undStop: sg.undStop, time: sg.time, score: sg.score, text: signalText(sg), status: 'open' });
      // açık sinyal sonuçlarını barlarla güncelle
      if (it.bars?.length) for (const x of journal.get().signals) {
        if (x.ticker !== it.ticker || x.status !== 'open') continue;
        const o = outcome(x as unknown as Signal, it.bars, Date.now());
        if (o.status !== 'open') journal.updateSignal(x.id, { status: o.status, resolvedAt: o.at });
      }
    });
    setLast(Date.now()); setNow(Date.now()); busyRef.current = false; setBusy(false);
  }, []);

  // İlk açılışta bir kez yükle; piyasa açıkken otomatik yenile
  const booted = useRef(false);
  useEffect(() => {
    if (!ready || !active || booted.current) return;
    const t = setTimeout(() => { booted.current = true; refresh(); }, 0); return () => clearTimeout(t);
  }, [ready, active, refresh]);
  useEffect(() => {
    // Bildirim açıksa başka sekmedeyken de tarar (uygulama ön plandayken; arka planda iOS zamanlayıcıları durdurur)
    if (!(active || (nc.signals && booted.current)) || !cfg.auto) return;
    const id = setInterval(() => { setNow(Date.now()); nextRefresh('quotes', Date.now() + cfg.interval * 60000); if (marketOpen()) refresh(); }, cfg.interval * 60000);
    return () => clearInterval(id);
  }, [active, cfg.auto, cfg.interval, refresh, nc.signals]);
  // Tazelik göstergesi: bu ekranın beklenen yenileme aralığı (kapalıysa bildirilmez)
  useEffect(() => {
    const ms = cfg.auto ? cfg.interval * 60000 : null;
    setExpected('quotes', ms, 'odte'); setExpected('md-options', ms, 'odte');
    return () => { setExpected('quotes', null, 'odte'); setExpected('md-options', null, 'odte'); };
  }, [cfg.auto, cfg.interval]);

  const list = [...cfg.watch, ...cfg.extras.filter(x => !cfg.watch.includes(x))];
  const rows = list.map(t => items[t] ?? { ticker: t, ok: false, credits: 0, time: 0 } as ScanItem)
    .sort((a, b) => (b.result?.signal ? 1 : 0) - (a.result?.signal ? 1 : 0) || Math.abs(b.result?.score ?? 0) - Math.abs(a.result?.score ?? 0));
  const loaded = rows.filter(r => r.ok);
  const delayed = loaded.some(r => (r.delayedMin ?? 15) > 0 || !/MarketData|Tradier/.test(r.source || ''));
  const credits = loaded.reduce((a, r) => a + r.credits, 0);
  const isOpen = marketOpen(now);
  const addSym = () => {
    const v = add.trim().toUpperCase().replace(/^\$/, '');
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(v)) return;
    setCfg(c => c.watch.includes(v) ? c : { ...c, watch: [...c.watch, v] }); setAdd('');
  };
  const logTrade = async (sg: Signal, b: Bought, und?: number) => {
    const exitAt = exitAtMs(sg.time, sg.dte);
    const t = { id: newId(), ticker: sg.ticker, type: sg.dir, strike: sg.strike, expiry: sg.expiry, qty: b.qty, entry: b.entry, entryTime: Date.now(), fromSignal: true,
      target: b.target, stop: b.stop, undTarget: sg.undTarget, undStop: sg.undStop, undRef: und, exitAt, watch: true, note: signalText(sg) };
    journal.addTrade(t);
    const okPerm = await ensurePermission(true); setPerm(await permissionStatus());
    if (okPerm) { const ids = await scheduleExit(t); if (ids.length) journal.updateTrade(t.id, { notifIds: ids }); }
    setBgInfo(await syncBackgroundTask());
    const past = exitAt <= Date.now();
    Alert.alert('Aldım — kaydedildi',
      `${sg.ticker} ${sg.strike}${sg.dir === 'call' ? 'C' : 'P'} · ${b.qty} kontrat @ $${b.entry.toFixed(2)}\nKâr al $${b.target.toFixed(2)} · stop $${b.stop.toFixed(2)}\n` +
      (past ? 'Planlanan çıkış saati geçti.' : `Çıkış: ${trHM(exitAt)} (telefon saatiyle ${localHM(exitAt)}).`) +
      (okPerm ? (past ? '' : ' Çıkıştan 10 dk önce ve çıkış saatinde bildirim gelecek; hedefe/stopa yaklaşınca da haber vereceğim.') : '\nBildirim izni yok — uyarılar gönderilemez.'),
      [{ text: 'Tamam' }, { text: 'Geçmiş’e git', onPress: onJournal }]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={C.blue} />} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
        <View>
          <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>0DTE Sinyal</Text>
          <Text style={{ color: isOpen ? C.pos : C.muted, fontSize: 13, fontWeight: '600' }}>
            {isOpen ? '● Piyasa açık' : '○ Piyasa kapalı'} · {trHM(now)}{last ? ` · son ${trHM(last)}` : ''}
          </Text>
          <View style={{ marginTop: 6 }}><FreshnessPill /></View>
        </View>
        <Pressable onPress={() => { tap(); refresh(); }} style={({ pressed }) => [st.refresh, pressed && { opacity: .6 }]} accessibilityLabel="Yenile">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>↻ Yenile</Text>}
        </Pressable>
      </View>

      {delayed ? (
        <View style={st.banner}><Text style={st.bannerT}>⏱ ~15 dk gecikmeli — test amaçlı</Text>
          <Text style={st.bannerS}>Zincir: CBOE gecikmeli · barlar: Yahoo. {hasMd ? 'MarketData token var ama veri güncel değil (deneme planı önceki seansı verir).' : 'Gerçek zamanlı için ücretli MarketData token’ı Hesapla › Ayarlar’a gir.'}</Text></View>
      ) : null}

      <Card title="İzleme listesi" right={<Btn label={edit ? 'Bitti' : 'Düzenle'} onPress={() => setEdit(e => !e)} style={{ minHeight: 38 }} />}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {cfg.watch.map(t => (
            <Chip key={t} label={edit ? `${t} ✕` : t} active={!!items[t]?.result?.signal}
              onPress={() => edit ? setCfg(c => ({ ...c, watch: c.watch.filter(x => x !== t) })) : setOpen(o => ({ ...o, [t]: !o[t] }))} />
          ))}
        </View>
        {edit ? (
          <View style={[s.row, { marginTop: 10 }]}>
            <View style={[s.inputWrap, { flex: 1 }]}>
              <TextInput value={add} onChangeText={setAdd} onSubmitEditing={addSym} placeholder="Sembol ekle (ör. AAPL)" placeholderTextColor="#55617a"
                autoCapitalize="characters" autoCorrect={false} keyboardAppearance="dark" style={s.input} returnKeyType="done" />
            </View>
            <Btn label="Ekle" kind="primary" onPress={addSym} />
          </View>
        ) : null}
        <Text style={[s.label, { marginTop: 12 }]}>Ek semboller (isteğe bağlı — veri/kredi artırır)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {EXTRAS.map(t => <Chip key={t} label={(cfg.extras.includes(t) ? '✓ ' : '+ ') + t} active={cfg.extras.includes(t)}
            onPress={() => setCfg(c => ({ ...c, extras: c.extras.includes(t) ? c.extras.filter(x => x !== t) : [...c.extras, t] }))} />)}
        </View>
        {edit ? <Btn label="Varsayılan listeye dön" onPress={() => setCfg(c => ({ ...c, watch: DEFAULT_WATCH }))} style={{ marginTop: 10 }} /> : null}
      </Card>

      <Card title="Otomatik yenileme" right={<Switch value={cfg.auto} onValueChange={v => setCfg(c => ({ ...c, auto: v }))} />}>
        <Seg value={cfg.interval} onChange={v => setCfg(c => ({ ...c, interval: v }))} options={[[2, '2 dk'], [5, '5 dk'], [10, '10 dk'], [15, '15 dk']]} />
        <View style={{ height: 8 }} />
        <Seg value={cfg.orMin} onChange={v => setCfg(c => ({ ...c, orMin: v }))} options={[[15, 'ORB 15 dk'], [30, 'ORB 30 dk']]} small />
        <Text style={s.hint}>
          Yalnızca ABD seansında (TR {etToIst(9, 30)}–{etToIst(16, 0)}) çalışır.{' '}
          {hasMd
            ? `MarketData tahmini: ~${creditsPerRefresh(list.length, cfg.strikeLimit).toLocaleString('tr-TR')} kredi/yenileme (${list.length} sembol × (zincir ${2 * cfg.strikeLimit} + fiyat/vade/mum 3)); ${cfg.interval} dk aralıkla seans başına ~${Math.round(creditsPerRefresh(list.length, cfg.strikeLimit) * 390 / cfg.interval).toLocaleString('tr-TR')} kredi.`
            : 'CBOE/Yahoo: kredi yok; büyük sembollerde yenileme başına birkaç MB veri.'}
          {last && credits ? ` Son yenileme: ${credits} kredi.` : ''}
        </Text>
      </Card>

      <Card title="Bildirimler">
        <View style={[s.row, { justifyContent: 'space-between', minHeight: 40 }]}>
          <Text style={{ color: C.text, fontSize: 15, flex: 1 }}>Yeni sinyal bildirimi</Text>
          <Switch value={nc.signals} onValueChange={v => { setNotif({ signals: v }); if (v) ensurePermission(true).then(() => permissionStatus().then(setPerm)); }} />
        </View>
        <View style={[s.row, { justifyContent: 'space-between', minHeight: 40 }]}>
          <Text style={{ color: C.text, fontSize: 15, flex: 1 }}>Aldığım pozisyon: hedef / stop / çıkış uyarısı</Text>
          <Switch value={nc.positions} onValueChange={v => { setNotif({ positions: v }); if (v) ensurePermission(true).then(() => permissionStatus().then(setPerm)); }} />
        </View>
        <View style={[s.row, { justifyContent: 'space-between', minHeight: 40 }]}>
          <Text style={{ color: C.text, fontSize: 15, flex: 1 }}>Arka planda kontrol (deneysel)</Text>
          <Switch value={nc.background} onValueChange={v => setNotif({ background: v })} />
        </View>
        <View style={[s.row, { marginTop: 6 }]}>
          <Btn label="Test bildirimi" onPress={async () => { await testNotification(); setPerm(await permissionStatus()); }} style={{ flex: 1 }} />
        </View>
        <Text style={s.hint}>
          İzin: {perm === 'granted' ? 'verildi ✓' : perm === 'denied' ? 'kapalı — Ayarlar › Expo Go › Bildirimler' : 'henüz sorulmadı'}{bgInfo ? ` · Arka plan: ${bgInfo}` : ''}{'\n'}
          Sinyal taraması ve hedef/stop kontrolü uygulama açıkken çalışır (her sinyal için günde bir bildirim). Çıkış saati bildirimi telefona önceden zamanlanır, uygulama kapalıyken de gelir.
          Uygulama kapalı/arka plandayken yeni sinyal taraması yapılamaz; hedef/stop kontrolünü sistem arada bir (≥15 dk, garanti değil) çalıştırabilir.
        </Text>
      </Card>

      {rows.map(it => <TickerCard key={it.ticker} it={it} open={!!open[it.ticker]} toggle={() => setOpen(o => ({ ...o, [it.ticker]: !o[it.ticker] }))} onLog={logTrade} busy={busy} />)}
      <Text style={[s.hint, { textAlign: 'center' }]}>Kurallara dayalı otomatik analizdir, yatırım tavsiyesi değildir. Emir vermeden önce fiyatı aracı kurumda doğrula.</Text>
    </ScrollView>
  );
}

interface Bought { entry: number; qty: number; target: number; stop: number }
function BuyForm({ sg, onSave, onCancel }: { sg: Signal; onSave: (b: Bought) => void; onCancel: () => void }) {
  const [entry, setEntry] = useState<number | null>(sg.entry);
  const [qty, setQty] = useState<number | null>(1);
  const [target, setTarget] = useState<number | null>(sg.target);
  const [stop, setStop] = useState<number | null>(sg.stop);
  // giriş değişince hedef/stop aynı mesafeyle kayar (elle değiştirilmediyse)
  const [touched, setTouched] = useState(false);
  const onEntry = (v: number | null) => { setEntry(v); if (!touched && v != null && v > 0) { setTarget(+(v + sg.target - sg.entry).toFixed(2)); setStop(+Math.max(0.01, v - (sg.entry - sg.stop)).toFixed(2)); } };
  const ok = entry != null && entry > 0 && qty != null && qty >= 1 && target != null && target > entry && stop != null && stop >= 0 && stop < entry;
  return (
    <View style={{ marginTop: 10, backgroundColor: C.input, borderRadius: 12, padding: 10 }}>
      <Text style={{ color: C.text, fontWeight: '800', fontSize: 15, marginBottom: 8 }}>Aldığın kontrat</Text>
      <View style={s.row}>
        <NumField label="Alış fiyatı ($)" value={entry} onValue={onEntry} allowEmpty digits={2} />
        <StepField label="Kontrat" value={qty} onValue={v => setQty(v != null ? Math.max(1, Math.round(v)) : v)} step={1} min={1} digits={0} />
      </View>
      <View style={[s.row, { marginTop: 8 }]}>
        <NumField label="Kâr al ($)" value={target} onValue={v => { setTouched(true); setTarget(v); }} allowEmpty digits={2} />
        <NumField label="Stop ($)" value={stop} onValue={v => { setTouched(true); setStop(v); }} allowEmpty digits={2} />
      </View>
      {!ok ? <Text style={{ color: C.warn, fontSize: 12.5, marginTop: 6 }}>Alış &gt; 0, kâr al &gt; alış, stop &lt; alış olmalı.</Text> : null}
      <View style={[s.row, { marginTop: 10 }]}>
        <Btn label="Vazgeç" onPress={onCancel} style={{ flex: 1 }} />
        <Btn label="✓ Kaydet ve bildir" kind="primary" onPress={() => { if (ok) onSave({ entry: entry!, qty: qty!, target: target!, stop: stop! }); }} style={{ flex: 2, opacity: ok ? 1 : 0.5 }} />
      </View>
      <Text style={st.small}>Geçmiş’te açık pozisyon olur. Çıkış saatinden 10 dk önce ve çıkışta ({sg.exitBy}) bildirim; uygulama açıkken hedefe/stopa yaklaşınca ve ulaşınca bildirim.</Text>
    </View>
  );
}

function TickerCard({ it, open, toggle, onLog, busy }: { it: ScanItem; open: boolean; toggle: () => void; onLog: (s: Signal, b: Bought, und?: number) => void; busy: boolean }) {
  const r = it.result, sg = r?.signal, L = r?.levels;
  const [buy, setBuy] = useState(false);
  const bought = useJournal().trades.some(t => sg && t.exit == null && t.ticker === sg.ticker && t.strike === sg.strike && t.type === sg.dir && t.expiry === sg.expiry);
  const score = r?.score ?? 0, w = Math.min(1, Math.abs(score) / 6);
  return (
    <View style={[st.card, sg && { borderColor: sg.dir === 'call' ? C.pos : C.neg, borderWidth: 1.5 }]}>
      <Pressable onPress={() => { tap(); toggle(); }} style={[s.row, { justifyContent: 'space-between', minHeight: 44 }]}>
        <View style={s.row}>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{it.ticker}</Text>
          {it.dte != null ? <View style={[st.badge, { backgroundColor: it.dte === 0 ? 'rgba(250,204,21,.18)' : C.accentSoft }]}><Text style={{ color: it.dte === 0 ? C.warn : C.blue, fontWeight: '800', fontSize: 12 }}>{dteLabel(it.dte)}{it.expiry ? ' · ' + it.expiry.slice(5).replace('-', '/') : ''}</Text></View> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {it.ok ? <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>${f2(it.price)} <Text style={{ color: plColor(it.changePct ?? 0), fontSize: 14 }}>{(it.changePct ?? 0) >= 0 ? '+' : ''}{f2(it.changePct)}%</Text></Text>
            : <Text style={{ color: it.error ? C.neg : C.muted, fontSize: 13 }}>{it.error ? 'Hata' : busy ? 'Yükleniyor…' : '—'}</Text>}
        </View>
      </Pressable>
      {it.ok && it.verdict ? <View style={{ marginTop: 8 }}><ErrorBoundary label="Sonuç"><VerdictBlock ticker={it.ticker} v={it.verdict} /></ErrorBoundary></View> : null}
      {it.ok ? (
        <View style={[s.row, { marginTop: 6 }]}>
          <Text style={{ color: C.muted, fontSize: 12, width: 58 }}>Puan {score > 0 ? '+' : ''}{score.toFixed(1)}</Text>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.input, flexDirection: 'row' }}>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>{score < 0 ? <View style={{ width: `${w * 100}%`, height: 8, borderRadius: 4, backgroundColor: C.neg }} /> : null}</View>
            <View style={{ width: 2, backgroundColor: C.border }} />
            <View style={{ flex: 1 }}>{score > 0 ? <View style={{ width: `${w * 100}%`, height: 8, borderRadius: 4, backgroundColor: C.pos }} /> : null}</View>
          </View>
        </View>
      ) : null}
      {sg ? (
        <View style={[st.sig, { backgroundColor: sg.dir === 'call' ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)' }]}>
          <Text style={{ color: sg.dir === 'call' ? C.pos : C.neg, fontSize: 18, fontWeight: '900' }}>
            {it.ticker} {dteLabel(sg.dte)} {sg.strike}{sg.dir === 'call' ? 'C' : 'P'} AL
          </Text>
          <View style={st.paper}><Text style={st.paperT}>📝 Paper trading / test — gerçek parayla değil</Text></View>
          <View style={[s.row, { marginTop: 8, gap: 6 }]}>
            <Box k="Giriş ≤" v={`$${f2(sg.entry)}`} /><Box k="Kâr al" v={`$${f2(sg.target)}`} c={C.pos} /><Box k="Stop" v={`$${f2(sg.stop)}`} c={C.neg} /><Box k="R/R" v={sg.rr.toFixed(2)} />
          </View>
          <Text style={st.small}>En geç {sg.exitBy} çık · dayanak hedef {f2(sg.undTarget)} / stop {f2(sg.undStop)}</Text>
          <Text style={st.small}>Bid/Ask {f2(sg.bid)}/{f2(sg.ask)} · Δ {sg.delta.toFixed(2)} · Hacim {sg.volume.toLocaleString('tr-TR')} · OI {sg.oi.toLocaleString('tr-TR')}</Text>
          {buy ? <BuyForm sg={sg} onCancel={() => setBuy(false)} onSave={b => { setBuy(false); onLog(sg, b, it.price); }} />
            : <Btn label={bought ? '✓ Alındı — tekrar ekle' : '✓ Aldım'} kind="primary" onPress={() => setBuy(true)} style={{ marginTop: 10, minHeight: 48 }} />}
        </View>
      ) : it.ok && r ? (
        <Text style={{ color: C.muted, fontSize: 14, marginTop: 8 }}><Text style={{ color: C.text, fontWeight: '700' }}>Sinyal yok</Text> — {r.noSignal}</Text>
      ) : it.error ? <Text style={{ color: C.neg, fontSize: 13, marginTop: 6 }}>{it.error}</Text> : null}
      {it.ok && r && (open || sg) ? (
        <View style={{ marginTop: 10 }}>
          {r.reasons.map((x, i) => (
            <Text key={i} style={{ color: x.w > 0 ? C.pos : x.w < 0 ? C.neg : C.muted, fontSize: 13, lineHeight: 19 }}>{x.w > 0 ? '▲' : x.w < 0 ? '▼' : '•'} {x.text}</Text>
          ))}
          {L ? <Text style={[st.small, { marginTop: 6 }]}>
            VWAP {f2(L.vwap)} · OR {f2(L.orLow)}–{f2(L.orHigh)} · Call duvarı {L.callWall ?? '—'} · Put duvarı {L.putWall ?? '—'} · Max pain {L.maxPain ?? '—'} · Flip {f2(L.flip)} · Beklenen hareket ±{f2(L.em)}
          </Text> : null}
          <Text style={[st.small, { marginTop: 4 }]}>Kaynak: {it.source}{it.delayedMin ? ` (~${it.delayedMin} dk gecikmeli)` : ''} · barlar {it.barsSource}{it.credits ? ` · ${it.credits} kredi` : ''}{it.note ? ` · ${it.note}` : ''}</Text>
        </View>
      ) : null}
    </View>
  );
}
function Box({ k, v, c }: { k: string; v: string; c?: string }) {
  return <View style={{ flex: 1, backgroundColor: C.input, borderRadius: 10, padding: 8, alignItems: 'center' }}>
    <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>{k}</Text><Text style={{ color: c ?? C.text, fontSize: 16, fontWeight: '800', marginTop: 2 }}>{v}</Text></View>;
}
const st = {
  refresh: { minHeight: 48, minWidth: 110, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 14 },
  banner: { backgroundColor: 'rgba(250,204,21,.12)', borderColor: 'rgba(250,204,21,.45)', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  bannerT: { color: C.warn, fontWeight: '800' as const, fontSize: 15 },
  bannerS: { color: C.muted, fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 0.5, borderColor: C.border },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  sig: { borderRadius: 12, padding: 12, marginTop: 10 },
  small: { color: C.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  paper: { alignSelf: 'flex-start' as const, marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(250,204,21,.15)', borderWidth: 0.5, borderColor: 'rgba(250,204,21,.5)' },
  paperT: { color: C.warn, fontSize: 11.5, fontWeight: '800' as const },
};
